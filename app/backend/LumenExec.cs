// lumen-exec: runs one approved PowerShell command for Lumen's agent (v1.1), or reads a command's syntax tree.
//   lumen-exec.exe           first stdin line: {"command","cwd","timeoutMs"(0 = none),"env":{name:value}}
//                            stdout, one JSON object per line: {"t":"o","d":line} stdout, {"t":"e","d":line} stderr,
//                            {"t":"x","code":n,"timedOut":bool,"stopped":bool,"ms":n} once at the end.
//                            A later stdin line "stop", or stdin closing (Lumen quit), ends the command.
//   lumen-exec.exe --parse   first stdin line: {"command"}; stdout: one JSON object with what the command would run
//                            (execpolicy.cjs decides from it whether Auto mode may run it without asking).
// The helper puts itself into a Windows Job Object with KILL_ON_JOB_CLOSE before it starts PowerShell, so PowerShell and every
// process it starts are in the job: when the command ends, is stopped, times out, or this helper dies, they all end. The
// environment is exactly the one Lumen passes (keys and tokens already removed). Output is UTF-8 both ways; the command is
// passed with -EncodedCommand, so quotes and Turkish characters arrive unchanged.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Management.Automation.Language;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

static class LumenExec {
 [StructLayout(LayoutKind.Sequential)] struct BasicLimit{public long PerProcessUserTimeLimit,PerJobUserTimeLimit;public uint LimitFlags;public UIntPtr MinimumWorkingSetSize,MaximumWorkingSetSize;public uint ActiveProcessLimit;public UIntPtr Affinity;public uint PriorityClass,SchedulingClass;}
 [StructLayout(LayoutKind.Sequential)] struct IoCounters{public ulong ReadOperationCount,WriteOperationCount,OtherOperationCount,ReadTransferCount,WriteTransferCount,OtherTransferCount;}
 [StructLayout(LayoutKind.Sequential)] struct ExtendedLimit{public BasicLimit Basic;public IoCounters Io;public UIntPtr ProcessMemoryLimit,JobMemoryLimit,PeakProcessMemoryUsed,PeakJobMemoryUsed;}
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern IntPtr CreateJobObject(IntPtr attributes,string name);
 [DllImport("kernel32.dll")] static extern bool SetInformationJobObject(IntPtr job,int infoClass,ref ExtendedLimit info,uint length);
 [DllImport("kernel32.dll")] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
 [DllImport("kernel32.dll")] static extern bool TerminateJobObject(IntPtr job,uint exitCode);

 static readonly JavaScriptSerializer json=new JavaScriptSerializer{MaxJsonLength=int.MaxValue};
 static readonly object gate=new object();
 static StreamWriter output;
 static IntPtr job=IntPtr.Zero;
 static int finished=0;

 static void Emit(object value){lock(gate){output.Write(json.Serialize(value));output.Write('\n');output.Flush();}}

 static int Main(string[] args){
  output=new StreamWriter(Console.OpenStandardOutput(),new UTF8Encoding(false));
  var input=new StreamReader(Console.OpenStandardInput(),new UTF8Encoding(false));
  Dictionary<string,object> request;
  try{request=json.Deserialize<Dictionary<string,object>>(input.ReadLine()??"");if(request==null)throw new Exception();}
  catch{Emit(new Dictionary<string,object>{{"t","x"},{"code",-1},{"error","Invalid request."}});return 2;}
  if(args.Length>0&&args[0]=="--parse"){Emit(Parse(Str(request,"command")));return 0;}
  return Run(request,input);
 }
 static string Str(Dictionary<string,object> d,string key){object v;return d.TryGetValue(key,out v)&&v is string?(string)v:"";}

 static int Run(Dictionary<string,object> request,StreamReader input){
  string command=Str(request,"command"),cwd=Str(request,"cwd");
  int timeoutMs=0;object t;if(request.TryGetValue("timeoutMs",out t)&&t is int)timeoutMs=(int)t;
  if(command.Length==0||!Directory.Exists(cwd)){Emit(new Dictionary<string,object>{{"t","x"},{"code",-1},{"error","Missing command or folder."}});return 2;}
  job=CreateJobObject(IntPtr.Zero,null);
  var info=new ExtendedLimit();info.Basic.LimitFlags=0x2000;// JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
  if(job==IntPtr.Zero||!SetInformationJobObject(job,9,ref info,(uint)Marshal.SizeOf(typeof(ExtendedLimit)))||!AssignProcessToJobObject(job,Process.GetCurrentProcess().Handle)){
   Emit(new Dictionary<string,object>{{"t","x"},{"code",-1},{"error","Could not create the Windows job for the command."}});return 2;
  }
  string prelude="$ProgressPreference='SilentlyContinue';[Console]::OutputEncoding=[Text.Encoding]::UTF8;$OutputEncoding=[Text.Encoding]::UTF8;\n";
  string encoded=Convert.ToBase64String(Encoding.Unicode.GetBytes(prelude+command));
  string shell=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System),@"WindowsPowerShell\v1.0\powershell.exe");
  var psi=new ProcessStartInfo(shell,"-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand "+encoded){
   WorkingDirectory=cwd,UseShellExecute=false,CreateNoWindow=true,RedirectStandardInput=true,RedirectStandardOutput=true,RedirectStandardError=true,
   StandardOutputEncoding=new UTF8Encoding(false),StandardErrorEncoding=new UTF8Encoding(false)};
  object env;
  if(request.TryGetValue("env",out env)&&env is Dictionary<string,object>){psi.EnvironmentVariables.Clear();foreach(var kv in (Dictionary<string,object>)env)if(kv.Value is string)psi.EnvironmentVariables[kv.Key]=(string)kv.Value;}
  var watch=Stopwatch.StartNew();
  var outDone=new ManualResetEvent(false);var errDone=new ManualResetEvent(false);
  Process process;
  try{process=Process.Start(psi);}catch(Exception e){Emit(new Dictionary<string,object>{{"t","x"},{"code",-1},{"error","PowerShell did not start: "+e.Message}});return 2;}
  process.StandardInput.Close();
  process.OutputDataReceived+=(s,e)=>{if(e.Data==null)outDone.Set();else Emit(new Dictionary<string,object>{{"t","o"},{"d",e.Data}});};
  // With -EncodedCommand PowerShell writes its error stream as CLIXML; it is turned back into plain lines here.
  process.ErrorDataReceived+=(s,e)=>{
   if(e.Data==null){errDone.Set();return;}
   if(e.Data=="#< CLIXML")return;
   if(e.Data.StartsWith("<Objs ")){
    foreach(System.Text.RegularExpressions.Match m in System.Text.RegularExpressions.Regex.Matches(e.Data,"<S S=\"(?:Error|Warning|Verbose|Debug)\">(.*?)</S>")){
     string text=System.Net.WebUtility.HtmlDecode(System.Text.RegularExpressions.Regex.Replace(m.Groups[1].Value,"_x([0-9A-Fa-f]{4})_",x=>((char)Convert.ToInt32(x.Groups[1].Value,16)).ToString()));
     foreach(var line in text.Replace("\r\n","\n").TrimEnd('\n').Split('\n'))Emit(new Dictionary<string,object>{{"t","e"},{"d",line}});
    }
    return;
   }
   Emit(new Dictionary<string,object>{{"t","e"},{"d",e.Data}});
  };
  process.BeginOutputReadLine();process.BeginErrorReadLine();
  // Lumen asks to stop with a "stop" line; stdin closing means Lumen is gone.
  var stopper=new Thread(()=>{try{string line;while((line=input.ReadLine())!=null)if(line.Trim()=="stop")break;}catch{}End(-1,false,true,watch);}){IsBackground=true};
  stopper.Start();
  bool exited=timeoutMs>0?process.WaitForExit(timeoutMs):process.WaitForExit(int.MaxValue);
  if(!exited){End(-1,true,false,watch);return 1;}
  // Processes the command left running may still hold the output pipes open: give the readers a moment, then end the job.
  WaitHandle.WaitAll(new WaitHandle[]{outDone,errDone},2000);
  End(process.ExitCode,false,false,watch);
  return 0;
 }
 static void End(int code,bool timedOut,bool stopped,Stopwatch watch){
  if(Interlocked.Exchange(ref finished,1)!=0)return;
  Emit(new Dictionary<string,object>{{"t","x"},{"code",code},{"timedOut",timedOut},{"stopped",stopped},{"ms",watch.ElapsedMilliseconds}});
  // Ends PowerShell, everything it started, and this helper.
  TerminateJobObject(job,(uint)(code<0?1:code));
  Environment.Exit(code<0?1:code);
 }

 // What a command would run, from PowerShell's own parser. Nothing is executed.
 static Dictionary<string,object> Parse(string command){
  Token[] tokens;ParseError[] errors;
  var ast=Parser.ParseInput(command,out tokens,out errors);
  var commands=new List<object>();var redirections=new List<object>();var methods=new List<object>();var flags=new List<string>();
  foreach(var node in ast.FindAll(a=>true,true)){
   var c=node as CommandAst;
   if(c!=null){
    var name=c.GetCommandName();
    var args=new List<object>();
    foreach(var el in c.CommandElements.Skip(1)){
     var s=el as StringConstantExpressionAst;var p=el as CommandParameterAst;
     if(s!=null)args.Add(new Dictionary<string,object>{{"k","s"},{"v",s.Value}});
     else if(p!=null)args.Add(new Dictionary<string,object>{{"k","p"},{"v",p.ParameterName},{"arg",p.Argument==null?null:p.Argument.Extent.Text}});
     else args.Add(new Dictionary<string,object>{{"k","x"},{"v",el.Extent.Text},{"type",el.GetType().Name}});
    }
    commands.Add(new Dictionary<string,object>{{"name",name},{"dynamic",name==null},{"op",c.InvocationOperator==TokenKind.Ampersand?"&":c.InvocationOperator==TokenKind.Dot?".":""},{"args",args}});
    continue;
   }
   var f=node as FileRedirectionAst;
   if(f!=null){redirections.Add(new Dictionary<string,object>{{"kind","file"},{"target",f.Location.Extent.Text},{"append",f.Append}});continue;}
   if(node is MergingRedirectionAst){redirections.Add(new Dictionary<string,object>{{"kind","merge"},{"target",node.Extent.Text}});continue;}
   var m=node as InvokeMemberExpressionAst;
   if(m!=null){methods.Add(new Dictionary<string,object>{{"text",m.Extent.Text},{"static",m.Static}});continue;}
   if(node is FunctionDefinitionAst)flags.Add("function");
   else if(node is TypeDefinitionAst)flags.Add("class");
   else if(node is UsingStatementAst)flags.Add("using");
   else if(node is ConfigurationDefinitionAst)flags.Add("configuration");
   else if(node is DynamicKeywordStatementAst)flags.Add("keyword");
   else if(node is CommandExpressionAst&&((CommandExpressionAst)node).Expression is ScriptBlockExpressionAst)flags.Add("scriptblock-value");
  }
  return new Dictionary<string,object>{
   {"errors",errors.Select(e=>(object)e.Message).ToList()},{"commands",commands},{"redirections",redirections},{"methods",methods},{"flags",flags.Distinct().Cast<object>().ToList()}};
 }
}
