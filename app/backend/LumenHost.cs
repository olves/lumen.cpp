// lumen-host: runs the unchanged lumen-core-beta bridge in-process and adds two bounded actions against the llama-server
// the bridge already manages:
//   "complete" - agent requests (planner, subagent steps, synthesis), optionally constrained by a JSON schema;
//   "chat"     - a normal chat turn with the user's thinking, response length and temperature settings. The bridge itself
//                always sends thinking off, 512 tokens and temperature 0.7. History selection and saving follow the bridge
//                exactly (its own PromptMessages/Count, the same binary search over user turns, the same save order).
// The model is never loaded twice: both actions reuse DesktopBridge.session and its single --parallel 1 server.
// Build (.NET Framework 4.8 csc, C# 5):
//   csc /nologo /target:exe /out:lumen-host.exe /r:lumen-core-beta.exe /r:System.Web.Extensions.dll /r:System.Net.Http.dll LumenHost.cs
using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Sockets;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using Lumen;

static class LumenHost {
 const BindingFlags Any=BindingFlags.Public|BindingFlags.NonPublic|BindingFlags.Static|BindingFlags.Instance;
 static readonly MethodInfo emitMethod=typeof(DesktopBridge).GetMethod("Emit",Any);
 static readonly MethodInfo handleMethod=typeof(DesktopBridge).GetMethod("Handle",Any);
 static readonly MethodInfo chatMethod=typeof(DesktopBridge).GetMethod("Chat",Any);
 static readonly MethodInfo saveMethod=typeof(ChatStore).GetMethod("Save",Any);
 static readonly MethodInfo promptMethod=typeof(NativeServer).GetMethod("PromptMessages",Any);
 static readonly MethodInfo countMethod=typeof(NativeServer).GetMethod("Count",Any);
 static readonly FieldInfo gateField=typeof(DesktopBridge).GetField("gate",Any);
 static readonly FieldInfo activeField=typeof(DesktopBridge).GetField("active",Any);
 static readonly FieldInfo sessionField=typeof(DesktopBridge).GetField("session",Any);
 static readonly FieldInfo serverField=typeof(ChatSession).GetField("server",Any);
 static readonly FieldInfo loadedField=typeof(ChatSession).GetField("loaded",Any);
 static readonly FieldInfo loadedContextField=typeof(ChatSession).GetField("loadedContext",Any);
 static readonly FieldInfo endpointField=typeof(NativeServer).GetField("endpoint",Any);
 static readonly FieldInfo keyField=typeof(NativeServer).GetField("key",Any);
 static readonly MethodInfo preferencesMethod=typeof(BackendManager).GetMethod("Preferences",Any);
 static readonly MethodInfo readyMethod=typeof(BackendManager).GetMethod("Ready",Any);
 static readonly MethodInfo executableMethod=typeof(BackendManager).GetMethod("Executable",Any);
 static readonly FieldInfo processField=typeof(NativeServer).GetField("process",Any);
 static readonly FieldInfo logField=typeof(NativeServer).GetField("log",Any);
 static readonly FieldInfo gpuActiveField=typeof(NativeServer).GetField("gpuActive",Any);
 static readonly FieldInfo serverBackendField=typeof(NativeServer).GetField("Backend",Any);
 static readonly FieldInfo liveField=typeof(NativeServer).GetField("live",Any);
 static readonly HttpClient http=new HttpClient{Timeout=Timeout.InfiniteTimeSpan};
 static readonly int[] contexts={2048,4096,8192,16384,32768};

 static int Main(string[] args){
  if(args.Length<2||args[0]!="--bridge"){Console.Error.WriteLine("usage: lumen-host --bridge <data folder>");return 2;}
  foreach(var member in new MemberInfo[]{emitMethod,handleMethod,chatMethod,saveMethod,promptMethod,countMethod,gateField,activeField,sessionField,serverField,loadedField,loadedContextField,endpointField,keyField,preferencesMethod,readyMethod,executableMethod,processField,logField,gpuActiveField,serverBackendField,liveField})
   if(member==null){Console.Error.WriteLine("lumen-host: the bundled engine bridge is not compatible.");return 3;}
  ServicePointManager.SecurityProtocol=SecurityProtocolType.Tls12;
  KillChildrenWithHost();
  NativeEngine.Data=Path.GetFullPath(args[1]);
  Run();
  return 0;
 }

// Puts the host in a Windows job that kills every process in it when the host's last handle closes. llama-server and other
 // children inherit the job, so a crashed or force-closed host never leaves a model loaded in GPU memory.
 [StructLayout(LayoutKind.Sequential)] struct BasicLimit{public long PerProcessUserTimeLimit,PerJobUserTimeLimit;public uint LimitFlags;public UIntPtr MinimumWorkingSetSize,MaximumWorkingSetSize;public uint ActiveProcessLimit;public UIntPtr Affinity;public uint PriorityClass,SchedulingClass;}
 [StructLayout(LayoutKind.Sequential)] struct IoCounters{public ulong a,b,c,d,e,f;}
 [StructLayout(LayoutKind.Sequential)] struct ExtendedLimit{public BasicLimit Basic;public IoCounters Io;public UIntPtr ProcessMemoryLimit,JobMemoryLimit,PeakProcessMemoryUsed,PeakJobMemoryUsed;}
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern IntPtr CreateJobObject(IntPtr attributes,string name);
 [DllImport("kernel32.dll")] static extern bool SetInformationJobObject(IntPtr job,int infoClass,ref ExtendedLimit info,uint length);
 [DllImport("kernel32.dll")] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
 static IntPtr hostJob;
 static void KillChildrenWithHost(){
  try{
   hostJob=CreateJobObject(IntPtr.Zero,null);if(hostJob==IntPtr.Zero)return;
   var info=new ExtendedLimit();info.Basic.LimitFlags=0x2000;// JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
   if(!SetInformationJobObject(hostJob,9,ref info,(uint)Marshal.SizeOf(typeof(ExtendedLimit)))||!AssignProcessToJobObject(hostJob,Process.GetCurrentProcess().Handle))Console.Error.WriteLine("lumen-host: child cleanup job unavailable.");
  }catch(Exception e){Console.Error.WriteLine("lumen-host: child cleanup job unavailable: "+e.Message);}
 }

 static object Gate{get{return gateField.GetValue(null);}}
 static void Emit(string id,string type,object data){emitMethod.Invoke(null,new object[]{id,type,data});}
 static string Str(Dictionary<string,object> a,string key){return a!=null&&a.ContainsKey(key)&&a[key]!=null?Convert.ToString(a[key]):"";}
 static bool Bool(Dictionary<string,object> a,string key){return a.ContainsKey(key)&&a[key] is bool&&(bool)a[key];}
 static int Int(Dictionary<string,object> a,string key,int fallback,int min,int max){int value=fallback;if(a.ContainsKey(key)&&a[key]!=null){try{value=Convert.ToInt32(a[key]);}catch{throw new Exception("Invalid "+key+".");}}if(value<min||value>max)throw new Exception("Invalid "+key+".");return value;}
 static double Num(Dictionary<string,object> a,string key,double fallback,double min,double max){double value=fallback;if(a.ContainsKey(key)&&a[key]!=null){try{value=Convert.ToDouble(a[key]);}catch{throw new Exception("Invalid "+key+".");}}if(double.IsNaN(value)||value<min||value>max)throw new Exception("Invalid "+key+".");return value;}

 // Mirrors DesktopBridge.Run: one request at a time, "cancel" cancels the active request immediately.
 static void Run(){
  Console.InputEncoding=new UTF8Encoding(false);Console.OutputEncoding=new UTF8Encoding(false);
  ModelDirectory.Load();
  Task chain=Task.FromResult(0);string line;
  while((line=Console.ReadLine())!=null){
   try{
    var json=new JavaScriptSerializer{MaxJsonLength=16000000};
    var message=json.Deserialize<Dictionary<string,object>>(line);
    string id=Str(message,"id"),action=Str(message,"action");
    var a=message.ContainsKey("args")&&message["args"] is Dictionary<string,object>?(Dictionary<string,object>)message["args"]:new Dictionary<string,object>();
    if(action=="cancel"){lock(Gate){var active=(CancellationTokenSource)activeField.GetValue(null);if(active!=null)active.Cancel();}Emit(id,"done",true);continue;}
    chain=chain.ContinueWith(previous=>Execute(id,action,a)).Unwrap();
   }catch(Exception e){Emit("","error",new{message=e.Message});}
  }
  lock(Gate){var active=(CancellationTokenSource)activeField.GetValue(null);if(active!=null)active.Cancel();}
  try{chain.Wait(5000);}catch{}
  ((ChatSession)sessionField.GetValue(null)).Dispose();
 }

 static async Task Execute(string id,string action,Dictionary<string,object> a){
  var cts=new CancellationTokenSource();
  lock(Gate)activeField.SetValue(null,cts);
  try{
   if(action=="complete")Emit(id,"done",await Complete(id,a,cts.Token));
   else if(action=="chat")Emit(id,"done",await ChatTurn(id,a,cts.Token));
   else if(action=="benchmark")Emit(id,"done",await Benchmark(id,a,cts.Token));
   else await (Task)handleMethod.Invoke(null,new object[]{id,action,a,cts.Token});
  }catch(Exception e){
   while(e is TargetInvocationException&&e.InnerException!=null)e=e.InnerException;
   Emit(id,"error",new{message=cts.IsCancellationRequested?"Cancelled":e.Message,cancelled=cts.IsCancellationRequested});
  }finally{lock(Gate)activeField.SetValue(null,null);}
 }

 // Engine settings chosen in Lumen. gpu: "auto" lets llama.cpp fit layers (and MoE experts) to free GPU memory, "gpu" puts every
 // layer on the GPU (the bridge's -ngl 99), "cpu" uses the CPU engine. kv: "q8_0" halves context memory. speculative: n-gram
 // drafting from the conversation itself, plus the model's MTP draft file when one is installed.
 class EngineOptions{public string Gpu="auto";public string Kv="f16";public bool Speculative;}
 static EngineOptions Options(Dictionary<string,object> a){
  var e=a.ContainsKey("engine")?a["engine"] as Dictionary<string,object>:null;if(e==null)return null;var o=new EngineOptions();
  string gpu=Str(e,"gpu");if(gpu=="auto"||gpu=="gpu"||gpu=="cpu")o.Gpu=gpu;else if(gpu!="")throw new Exception("Invalid engine options.");
  string kv=Str(e,"kv");if(kv=="q8_0"||kv=="f16")o.Kv=kv;else if(kv!="")throw new Exception("Invalid engine options.");
  o.Speculative=Bool(e,"speculative");return o;
 }
 // What the current server was started with. The bridge only knows the model and context; the rest is tracked here.
 static string loadedSignature,loadedProjector="",loadedDraft="";static EngineOptions loadedOptions;
 // projector/draft/options: null keeps what is loaded for the same model (agent steps); "" requires none; a path requires that file.
 static async Task<NativeServer> EnsureServer(string id,string model,int context,CancellationToken ct,string projector=null,string draft=null,EngineOptions options=null){
  var catalogModel=NativeEngine.Catalog.FirstOrDefault(c=>c.Name==model);if(catalogModel==null)throw new Exception("Unknown model.");
  string path=NativeEngine.ModelPath(catalogModel);if(!File.Exists(path)||new FileInfo(path).Length!=catalogModel.Bytes)throw new Exception("The model is not downloaded yet.");
  if(!string.IsNullOrEmpty(projector))projector=CheckedFile(projector,"models",".gguf",4L<<30,"vision projector");
  if(!string.IsNullOrEmpty(draft))draft=CheckedFile(draft,"models",".gguf",2L<<30,"draft model");
  var session=(ChatSession)sessionField.GetValue(null);var server=(NativeServer)serverField.GetValue(session);
  bool sameModel=server!=null&&(string)loadedField.GetValue(session)==model&&(int)loadedContextField.GetValue(session)==context&&loadedSignature!=null;
  if(projector==null)projector=sameModel?loadedProjector:"";if(draft==null)draft=sameModel?loadedDraft:"";
  if(options==null)options=loadedOptions??new EngineOptions();
  string signature=string.Join("|",new[]{path,context.ToString(),projector,draft,options.Gpu,options.Kv,options.Speculative?"1":"0"}).ToLowerInvariant();
  if(!sameModel||signature!=loadedSignature){
   session.Dispose();loadedSignature=null;
   Action<string,double> progress=(label,value)=>Emit(id,"progress",new{label=label,value=value});
   server=await StartServer(path,context,projector,draft,options,progress,ct);
   serverField.SetValue(session,server);loadedField.SetValue(session,model);loadedContextField.SetValue(session,context);
   loadedSignature=signature;loadedProjector=projector;loadedDraft=draft;loadedOptions=options;
  }
  return server;
 }

 // Mirrors BackendManager.Start (preferred engine, then Vulkan, then CPU; a GPU engine that offloads nothing is skipped) but builds
 // llama-server's arguments here. If the extra options stop a server from starting, the same engine is retried without them.
 static async Task<NativeServer> StartServer(string model,int context,string projector,string draft,EngineOptions options,Action<string,double> progress,CancellationToken ct){
  var preferences=preferencesMethod.Invoke(null,null);var backendField=preferences==null?null:preferences.GetType().GetField("Backend");
  string preferred=backendField==null?"cpu":(Convert.ToString(backendField.GetValue(preferences))??"cpu");if(preferred=="")preferred="cpu";
  var order=options.Gpu=="cpu"||preferred=="cpu"?new[]{"cpu"}:new[]{preferred,"vulkan","cpu"}.Distinct().ToArray();
  Exception last=null;
  foreach(var backend in order){
   if(!(bool)readyMethod.Invoke(null,new object[]{backend}))continue;
   string standard=(string)executableMethod.Invoke(null,new object[]{backend});
   // An engine update installed by Lumen (engine-override.json) is tried first; if it cannot start or does not use the GPU,
   // it is marked as failed and the bundled engine runs instead, so an update can never leave chat without an engine.
   string custom=OverrideExe(backend);
   foreach(string exe in custom!=null?new[]{custom,standard}:new[]{standard}){
    bool isCustom=custom!=null&&exe==custom;Exception attempt=null;
    foreach(bool plain in new[]{false,true}){
     bool extras=options.Kv!="f16"||options.Speculative;if(plain&&!extras)continue;
     progress("Loading engine · "+backend.ToUpperInvariant(),0);
     NativeServer server=null;
     try{
      server=await Launch(exe,backend,Arguments(model,context,projector,plain?"":draft,backend,options,plain),ct);
      if(backend!="cpu"&&!(bool)gpuActiveField.GetValue(server)){server.Dispose();last=attempt=new Exception("The GPU engine did not use the GPU.");break;}
      progress("Engine · "+backend.ToUpperInvariant(),100);return server;
     }catch(OperationCanceledException){if(server!=null)server.Dispose();throw;}
     catch(Exception e){if(server!=null)server.Dispose();if(ct.IsCancellationRequested)throw new OperationCanceledException();last=attempt=e;Console.Error.WriteLine("lumen-host: "+backend+(isCustom?" (updated engine)":"")+(plain?" (plain)":"")+" start failed: "+e.Message);}
    }
    if(isCustom)MarkOverrideFailed(attempt);
   }
  }
  throw new Exception("Unable to start the local engine. Try a smaller model or CPU mode."+(last!=null?" ("+(last.Message.Length>200?last.Message.Substring(0,200):last.Message)+")":""));
 }

 // <data>/engine-override.json: {"build","backend","path"} written by Lumen after it verified and tested a newer llama.cpp.
 // Only a llama-server.exe under <data>/runtime is accepted, and only for the engine it was installed for.
 static string OverrideFile(){return Path.Combine(NativeEngine.Data,"engine-override.json");}
 static string OverrideExe(string backend){
  try{
   if(!File.Exists(OverrideFile()))return null;
   var o=new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(File.ReadAllText(OverrideFile()));
   if(o==null||!o.ContainsKey("path")||!o.ContainsKey("backend")||Convert.ToString(o["backend"])!=backend)return null;
   if(o.ContainsKey("failed")&&Convert.ToBoolean(o["failed"]))return null;
   string exe=Path.GetFullPath(Convert.ToString(o["path"])),root=Path.GetFullPath(Path.Combine(NativeEngine.Data,"runtime"))+Path.DirectorySeparatorChar;
   if(!exe.StartsWith(root,StringComparison.OrdinalIgnoreCase)||!string.Equals(Path.GetFileName(exe),"llama-server.exe",StringComparison.OrdinalIgnoreCase)||!File.Exists(exe))return null;
   return exe;
  }catch{return null;}
 }
 static void MarkOverrideFailed(Exception e){
  try{
   var o=new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(File.ReadAllText(OverrideFile()));
   string message=e==null?"The updated engine did not start.":e.Message;
   o["failed"]=true;o["error"]=message.Length>300?message.Substring(0,300):message;o["failedAt"]=DateTime.UtcNow.ToString("o");
   File.WriteAllText(OverrideFile(),new JavaScriptSerializer().Serialize(o));
  }catch{}
 }

 static string Arguments(string model,int context,string projector,string draft,string backend,EngineOptions options,bool plain){
  var args=new StringBuilder();args.Append("-m \"").Append(model).Append('"');
  if(!string.IsNullOrEmpty(projector))args.Append(" --mmproj \"").Append(projector).Append('"');
  args.Append(" -c ").Append(context);
  // CPU engine: no GPU layers. "gpu": every layer, as the bridge does. "auto": -ngl stays unset so llama.cpp's --fit (on by default)
  // places layers and MoE experts by free memory, keeping a 1 GiB margin.
  if(backend=="cpu")args.Append(" -ngl 0");else if(options.Gpu=="gpu")args.Append(" -ngl 99");
  if(!plain&&options.Kv=="q8_0")args.Append(" -ctk q8_0 -ctv q8_0");
  if(!plain&&options.Speculative){args.Append(" --spec-type ").Append(string.IsNullOrEmpty(draft)?"ngram-simple":"draft-mtp,ngram-simple");if(!string.IsNullOrEmpty(draft))args.Append(" -md \"").Append(draft).Append('"');}
  args.Append(" --no-webui --jinja --parallel 1 -lv 4");
  return args.ToString();
 }

 // Starts llama-server as a NativeServer the bridge can use and dispose: loopback only, a random port and API key, log and GPU
 // detection the same way NativeServer.Start does them.
 static async Task<NativeServer> Launch(string exe,string backend,string arguments,CancellationToken ct){
  var server=(NativeServer)Activator.CreateInstance(typeof(NativeServer),true);
  var listener=new TcpListener(IPAddress.Loopback,0);listener.Start();int port=((IPEndPoint)listener.LocalEndpoint).Port;listener.Stop();
  string key=Guid.NewGuid().ToString("N");
  endpointField.SetValue(server,"http://127.0.0.1:"+port);keyField.SetValue(server,key);serverBackendField.SetValue(server,backend);
  var process=new Process{StartInfo=new ProcessStartInfo(exe,arguments+" --host 127.0.0.1 --port "+port+" --api-key "+key){UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,RedirectStandardError=true,WorkingDirectory=Path.GetDirectoryName(exe)}};
  DataReceivedEventHandler collect=(sender,e)=>{
   if(e.Data==null)return;
   lock(server){
    if(Regex.IsMatch(e.Data,"offloaded [1-9][0-9]*/"))gpuActiveField.SetValue(server,true);
    if(e.Data.Contains("offloaded ")||e.Data.Contains("model buffer size"))placementLog.GetOrCreateValue(server).AppendLine(e.Data);
    string log=(string)logField.GetValue(server)+e.Data+"\n";if(log.Length>16000)log=log.Substring(log.Length-16000);logField.SetValue(server,log);
   }
  };
  process.ErrorDataReceived+=collect;process.OutputDataReceived+=collect;
  processField.SetValue(server,process);
  process.Start();
  var live=liveField.GetValue(null) as HashSet<NativeServer>;if(live!=null)lock(live)live.Add(server);
  process.BeginErrorReadLine();process.BeginOutputReadLine();
  using(var client=new HttpClient{Timeout=TimeSpan.FromSeconds(2)}){
   var watch=Stopwatch.StartNew();
   while(true){
    ct.ThrowIfCancellationRequested();
    if(process.HasExited){string log;lock(server)log=(string)logField.GetValue(server);throw new Exception("The engine stopped while loading: "+Tail(log,400));}
    try{using(var response=await client.GetAsync("http://127.0.0.1:"+port+"/health",ct))if(response.IsSuccessStatusCode)break;}catch(HttpRequestException){}catch(TaskCanceledException){if(ct.IsCancellationRequested)throw new OperationCanceledException();}
    // Large models can take minutes to read from disk; the bridge allows 90 s.
    if(watch.Elapsed.TotalSeconds>300){server.Dispose();throw new Exception("The model took too long to load.");}
    await Task.Delay(400,ct);
   }
  }
  return server;
 }
 // Layer placement and weight-buffer lines, kept apart from the trimmed log (a draft model would push them out of it).
 static readonly System.Runtime.CompilerServices.ConditionalWeakTable<NativeServer,StringBuilder> placementLog=new System.Runtime.CompilerServices.ConditionalWeakTable<NativeServer,StringBuilder>();
 static string Tail(string text,int length){text=(text??"").Trim();return text.Length>length?text.Substring(text.Length-length):text;}

 // A file that must be inside <data>\<folder>, with the given extension and size limit.
 static string CheckedFile(string file,string folder,string extension,long maxBytes,string label){
  string root=Path.GetFullPath(Path.Combine(NativeEngine.Data,folder))+Path.DirectorySeparatorChar,full;
  try{full=Path.GetFullPath(file);}catch{throw new Exception("Invalid "+label+".");}
  if(!full.StartsWith(root,StringComparison.OrdinalIgnoreCase)||!full.EndsWith(extension,StringComparison.OrdinalIgnoreCase)||full.IndexOf('"')>=0||!File.Exists(full))throw new Exception("Invalid "+label+".");
  long size=new FileInfo(full).Length;if(size==0||size>maxBytes)throw new Exception("Invalid "+label+".");
  return full;
 }

 class StreamResult{public int Prompt;public int Completion;public string Finish="";public Dictionary<string,object> Timings;}

 static Dictionary<string,object> RequestBody(List<object> messages,int maxTokens,double temperature,bool thinking){
  // Thinking is always stated explicitly (enable_thinking). Reasoning is always parsed into reasoning_content, so a template that
  // still writes an empty <think></think> block with thinking off never leaks it into the answer.
  return new Dictionary<string,object>{{"messages",messages},{"stream",true},{"max_tokens",maxTokens},{"temperature",temperature},{"cache_prompt",true},
   {"stream_options",new Dictionary<string,object>{{"include_usage",true}}},{"reasoning_format","deepseek"},
   {"chat_template_kwargs",new Dictionary<string,object>{{"enable_thinking",thinking}}}};
 }

 // One streamed /v1/chat/completions request. Visible text and reasoning arrive through separate callbacks.
 static async Task<StreamResult> StreamCompletion(NativeServer server,Dictionary<string,object> body,CancellationToken ct,int timeout,Action<string> onContent,Action<string> onReasoning,Action<int,int> onUsage){
  var json=new JavaScriptSerializer{MaxJsonLength=16000000};var result=new StreamResult();
  using(var limit=CancellationTokenSource.CreateLinkedTokenSource(ct)){
   limit.CancelAfter(timeout);
   using(var request=new HttpRequestMessage(HttpMethod.Post,(string)endpointField.GetValue(server)+"/v1/chat/completions")){
    request.Headers.Authorization=new AuthenticationHeaderValue("Bearer",(string)keyField.GetValue(server));
    request.Content=new StringContent(json.Serialize(body),Encoding.UTF8,"application/json");
    using(var response=await http.SendAsync(request,HttpCompletionOption.ResponseHeadersRead,limit.Token))
    using(limit.Token.Register(()=>response.Dispose())){
     if(!response.IsSuccessStatusCode){string error=await response.Content.ReadAsStringAsync();throw new Exception("The engine rejected the request ("+(int)response.StatusCode+"): "+(error.Length>300?error.Substring(0,300):error));}
     using(var reader=new StreamReader(await response.Content.ReadAsStreamAsync(),new UTF8Encoding(false))){
      string line;
      while(true){
       try{line=await reader.ReadLineAsync();}catch(Exception){if(limit.IsCancellationRequested)break;throw;}
       if(line==null)break;limit.Token.ThrowIfCancellationRequested();
       if(!line.StartsWith("data: "))continue;string payload=line.Substring(6).Trim();if(payload=="[DONE]")break;
       var chunk=json.Deserialize<Dictionary<string,object>>(payload);
       if(chunk.ContainsKey("error"))throw new Exception("The engine returned an error.");
       var usage=chunk.ContainsKey("usage")?chunk["usage"] as Dictionary<string,object>:null;
       if(chunk.ContainsKey("timings")&&chunk["timings"] is Dictionary<string,object>)result.Timings=(Dictionary<string,object>)chunk["timings"];
       if(usage!=null){if(usage.ContainsKey("prompt_tokens"))result.Prompt=Convert.ToInt32(usage["prompt_tokens"]);if(usage.ContainsKey("completion_tokens"))result.Completion=Convert.ToInt32(usage["completion_tokens"]);if(onUsage!=null)onUsage(result.Prompt,result.Completion);}
       var choices=chunk.ContainsKey("choices")?chunk["choices"] as IList:null;if(choices==null||choices.Count==0)continue;
       var choice=choices[0] as Dictionary<string,object>;if(choice==null)continue;
       if(choice.ContainsKey("finish_reason")&&choice["finish_reason"]!=null)result.Finish=Convert.ToString(choice["finish_reason"]);
       var delta=choice.ContainsKey("delta")?choice["delta"] as Dictionary<string,object>:null;if(delta==null)continue;
       string thought=Str(delta,"reasoning_content");if(thought.Length>0&&onReasoning!=null)onReasoning(thought);
       string piece=Str(delta,"content");if(piece.Length>0)onContent(piece);
      }
     }
    }
   }
   if(ct.IsCancellationRequested)throw new OperationCanceledException();
   if(limit.IsCancellationRequested)throw new Exception("The model did not finish within the time limit.");
  }
  return result;
 }

 // A bounded completion used by the agent runtime. Schema-constrained steps never think (grammar and reasoning conflict).
 static async Task<object> Complete(string id,Dictionary<string,object> a,CancellationToken ct){
  string model=Str(a,"model");int context=Int(a,"contextSize",4096,2048,32768);if(!contexts.Contains(context))throw new Exception("Invalid context size.");
  int maxTokens=Int(a,"maxTokens",512,16,4096);double temperature=Num(a,"temperature",0.2,0,1.5);int timeout=Int(a,"timeoutMs",120000,1000,600000);bool stream=Bool(a,"stream");
  bool schema=a.ContainsKey("schema")&&a["schema"] is Dictionary<string,object>;bool thinking=Bool(a,"thinking")&&!schema;
  var rawMessages=a.ContainsKey("messages")?a["messages"] as IList:null;if(rawMessages==null||rawMessages.Count==0||rawMessages.Count>80)throw new Exception("Invalid messages.");
  var messages=new List<object>();int characters=0;
  foreach(var item in rawMessages){
   var m=item as Dictionary<string,object>;string role=Str(m,"role"),content=Str(m,"content");
   if(m==null||(role!="system"&&role!="user"&&role!="assistant"))throw new Exception("Invalid message role.");
   characters+=content.Length;if(characters>200000)throw new Exception("Request too large.");
   messages.Add(new Dictionary<string,object>{{"role",role},{"content",content}});
  }
  var server=await EnsureServer(id,model,context,ct,null,a.ContainsKey("draft")?Str(a,"draft"):null,Options(a));
  var body=RequestBody(messages,maxTokens,temperature,thinking);
  if(schema)body["response_format"]=new Dictionary<string,object>{{"type","json_schema"},{"json_schema",new Dictionary<string,object>{{"name","lumen_step"},{"strict",true},{"schema",a["schema"]}}}};
  var text=new StringBuilder();var reasoning=new StringBuilder();
  var result=await StreamCompletion(server,body,ct,timeout,
   piece=>{text.Append(piece);if(stream)Emit(id,"agent-chunk",piece);},
   thought=>{reasoning.Append(thought);if(stream)Emit(id,"agent-reasoning",thought);},null);
  return new{content=text.ToString(),reasoning=reasoning.ToString(),promptTokens=result.Prompt,completionTokens=result.Completion,finish=result.Finish,capacity=context};
 }

 // Speed lab. "standard": a fixed profile for comparable numbers (2,048 context, every layer on the GPU, no compact cache, no
 // speculation, 192 tokens, temperature 0, seed 42). "current": the engine options and context the chat uses. The model is
 // unloaded first so loading is measured on its own; the prompt goes through the model's own chat template.
 static async Task<object> Benchmark(string id,Dictionary<string,object> a,CancellationToken ct){
  string model=Str(a,"model"),profile=Str(a,"profile")=="current"?"current":"standard";
  var options=profile=="standard"?new EngineOptions{Gpu="gpu",Kv="f16",Speculative=false}:(Options(a)??new EngineOptions());
  int context=profile=="standard"?2048:Int(a,"contextSize",4096,2048,32768);if(!contexts.Contains(context))throw new Exception("Invalid context size.");
  string draft=profile=="standard"?"":(a.ContainsKey("draft")?Str(a,"draft"):"");
  ((ChatSession)sessionField.GetValue(null)).Dispose();loadedSignature=null;
  var load=Stopwatch.StartNew();var server=await EnsureServer(id,model,context,ct,"",draft,options);load.Stop();
  var messages=new List<object>{new Dictionary<string,object>{{"role","user"},{"content","Explain how a computer works in clear English. Write approximately 150 words."}}};
  var body=RequestBody(messages,192,0,false);body["seed"]=42;body["cache_prompt"]=false;
  var clock=Stopwatch.StartNew();double first=-1;
  var result=await StreamCompletion(server,body,ct,300000,piece=>{if(first<0)first=clock.Elapsed.TotalSeconds;Emit(id,"chunk",piece);},thought=>{if(first<0)first=clock.Elapsed.TotalSeconds;},null);
  clock.Stop();
  var t=result.Timings??new Dictionary<string,object>();Func<string,double> num=k=>t.ContainsKey(k)&&t[k]!=null?Convert.ToDouble(t[k]):-1;
  string log;lock(server)log=placementLog.GetOrCreateValue(server).ToString();// The main model has the most layers (an MTP draft logs its own, smaller line). Weight buffers show what stayed in RAM,
  // e.g. MoE experts with all layers "offloaded".
  Match offload=Match.Empty;foreach(Match candidate in Regex.Matches(log,@"offloaded (\d+)/(\d+) layers"))if(!offload.Success||int.Parse(candidate.Groups[2].Value)>int.Parse(offload.Groups[2].Value))offload=candidate;
  double gpuWeights=0,cpuWeights=0;foreach(Match buffer in Regex.Matches(log,@"(\S+) model buffer size\s*=\s*([\d.]+) MiB")){double size=double.Parse(buffer.Groups[2].Value,System.Globalization.CultureInfo.InvariantCulture);if(buffer.Groups[1].Value.StartsWith("CPU"))cpuWeights+=size;else gpuWeights+=size;}
  int ctxReal=context;try{using(var client=new HttpClient{Timeout=TimeSpan.FromSeconds(5)}){client.DefaultRequestHeaders.Authorization=new AuthenticationHeaderValue("Bearer",(string)keyField.GetValue(server));var props=new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(await client.GetStringAsync((string)endpointField.GetValue(server)+"/props"));var gen=props.ContainsKey("default_generation_settings")?props["default_generation_settings"] as Dictionary<string,object>:null;if(gen!=null&&gen.ContainsKey("n_ctx"))ctxReal=Convert.ToInt32(gen["n_ctx"]);}}catch(Exception){if(ct.IsCancellationRequested)throw;}
  return new{Protocol=profile=="standard"?"standard-2":"current",Model=model,Date=DateTime.Now.ToString("o"),Backend=(string)serverBackendField.GetValue(server),
   GpuLayers=offload.Success?offload.Groups[1].Value+"/"+offload.Groups[2].Value:"0",GpuWeightsMiB=Math.Round(gpuWeights),CpuWeightsMiB=Math.Round(cpuWeights),Context=ctxReal,Gpu=options.Gpu,Kv=options.Kv,Speculative=options.Speculative,Draft=draft!="",
   LoadSeconds=Math.Round(load.Elapsed.TotalSeconds,2),FirstTokenSeconds=Math.Round(first,3),TotalSeconds=Math.Round(clock.Elapsed.TotalSeconds,2),
   PromptTokens=(int)num("prompt_n"),PromptPerSecond=Math.Round(num("prompt_per_second"),1),Tokens=(int)num("predicted_n"),TokensPerSecond=Math.Round(num("predicted_per_second"),1),
   DraftTokens=(int)num("draft_n"),DraftAccepted=(int)num("draft_n_accepted")};
 }

 class TurnImages{public List<string> Files=new List<string>();public string Text;}
 // images: [{index, files:[png under <data>images], text}] for user messages; text replaces that message's content in the request only
 // (the saved message keeps its OCR wording). Ignored unless a vision projector is loaded.
 static Dictionary<ChatMessage,TurnImages> Images(Dictionary<string,object> a,Conversation chat,string projector){
  var result=new Dictionary<ChatMessage,TurnImages>();if(string.IsNullOrEmpty(projector)||!a.ContainsKey("images")||a["images"]==null)return result;
  var list=a["images"] as IList;if(list==null||list.Count>8)throw new Exception("Invalid images.");int total=0;
  foreach(var entry in list){
   var item=entry as Dictionary<string,object>;if(item==null)throw new Exception("Invalid images.");
   int index=Int(item,"index",-1,0,chat.Messages.Count-1);var message=chat.Messages[index];if(message.Role!="user")throw new Exception("Invalid images.");
   var files=item.ContainsKey("files")?item["files"] as IList:null;if(files==null||files.Count==0||files.Count>4)throw new Exception("Invalid images.");
   var turn=new TurnImages{Text=Str(item,"text")};if(turn.Text.Length>200000)throw new Exception("Invalid images.");
   foreach(var file in files)turn.Files.Add(CheckedFile(Convert.ToString(file),"images",".png",32L<<20,"image"));
   total+=turn.Files.Count;if(total>8)throw new Exception("Too many images.");result[message]=turn;
  }
  return result;
 }
 // Replaces the kept user messages that have photos with OpenAI-style content parts: the text, then each image as a PNG data URI.
 static void AttachImages(List<object> messages,List<ChatMessage> recent,int first,Conversation chat,Dictionary<ChatMessage,TurnImages> images){
  if(images.Count==0)return;int offset=messages.Count-(recent.Count-first);
  for(int i=first;i<recent.Count;i++){
   TurnImages turn;if(!images.TryGetValue(recent[i],out turn))continue;int position=offset+(i-first);if(position<0||position>=messages.Count)continue;
   var parts=new List<object>{new Dictionary<string,object>{{"type","text"},{"text",string.IsNullOrEmpty(turn.Text)?recent[i].Content:turn.Text}}};
   foreach(var file in turn.Files)parts.Add(new Dictionary<string,object>{{"type","image_url"},{"image_url",new Dictionary<string,object>{{"url","data:image/png;base64,"+Convert.ToBase64String(File.ReadAllBytes(file))}}}});
   messages[position]=new Dictionary<string,object>{{"role","user"},{"content",parts}};
  }
 }

 static List<object> WithGuidance(List<object> messages,string guidance){
  if(string.IsNullOrWhiteSpace(guidance)||messages.Count==0)return messages;var json=new JavaScriptSerializer();
  var first=json.Deserialize<Dictionary<string,object>>(json.Serialize(messages[0]));
  if(first!=null&&Str(first,"role")=="system")messages[0]=new Dictionary<string,object>{{"role","system"},{"content",Str(first,"content")+"\n\n"+guidance.Trim()}};
  else messages.Insert(0,new Dictionary<string,object>{{"role","system"},{"content",guidance.Trim()}});
  return messages;
 }

 // A normal chat turn. History selection mirrors NativeServer.Chat: drop Interrupted/empty messages, then binary-search the
 // oldest user turn to keep so that prompt + reserved reply tokens fit the server's n_ctx. Saving mirrors DesktopBridge.Handle.
 static async Task<object> ChatTurn(string id,Dictionary<string,object> a,CancellationToken ct){
  var chat=(Conversation)chatMethod.Invoke(null,new object[]{a});
  int context=Int(a,"contextSize",4096,2048,32768);if(!contexts.Contains(context))throw new Exception("Invalid context size.");
  bool thinking=Bool(a,"thinking");int reserve=Math.Min(Int(a,"maxTokens",512,128,8192),context/2);double temperature=Num(a,"temperature",0.7,0,1.5);
  // Selected skills: added to the request's system message only; the saved chat keeps the user's own instructions.
  string guidance=Str(a,"guidance");if(guidance.Length>30000)throw new Exception("The selected skills are too long.");
  string projector=a.ContainsKey("projector")?Str(a,"projector"):"";var images=Images(a,chat,projector);int imageTokens=Int(a,"imageTokens",300,64,4096);
  saveMethod.Invoke(null,new object[]{chat});
  var text=new StringBuilder();var reasoning=new StringBuilder();bool complete=false;
  try{
   var server=await EnsureServer(id,chat.Model,context,ct,projector,a.ContainsKey("draft")?Str(a,"draft"):"",Options(a));
   Emit(id,"progress",new{label="Responding locally",value=100.0});
   using(var client=new HttpClient{Timeout=Timeout.InfiniteTimeSpan}){
    client.DefaultRequestHeaders.Authorization=new AuthenticationHeaderValue("Bearer",(string)keyField.GetValue(server));
    string endpoint=(string)endpointField.GetValue(server);var json=new JavaScriptSerializer{MaxJsonLength=16000000};
    int capacity=context,trained=0;
    try{var props=json.Deserialize<Dictionary<string,object>>(await client.GetStringAsync(endpoint+"/props"));var generation=props.ContainsKey("default_generation_settings")?props["default_generation_settings"] as Dictionary<string,object>:null;if(generation!=null&&generation.ContainsKey("n_ctx"))capacity=Convert.ToInt32(generation["n_ctx"]);}catch(Exception){if(ct.IsCancellationRequested)throw;}
    var recent=chat.Messages.Where(m=>!m.Interrupted&&!string.IsNullOrWhiteSpace(m.Content)).ToList();
    var starts=recent.Select((m,i)=>new{m,i}).Where(x=>x.m.Role=="user").Select(x=>x.i).ToList();
    if(starts.Count==0)throw new Exception("A user message is required.");
    Func<int,List<object>> build=index=>WithGuidance((List<object>)promptMethod.Invoke(server,new object[]{chat,recent,index}),guidance);
    // Image tokens are not counted by /tokenize; each attached image in the kept window adds an estimate.
    Func<int,int> imageCost=index=>images.Where(x=>recent.IndexOf(x.Key)>=index).Sum(x=>x.Value.Files.Count)*imageTokens;
    Func<List<object>,Task<int>> textCount=list=>(Task<int>)countMethod.Invoke(server,new object[]{client,list,ct});
    Func<List<object>,Task<int>> count=list=>textCount(list);
    int selected=0;var messages=build(starts[0]);int tokens=await count(messages)+imageCost(starts[0]);
    if(tokens+reserve>capacity){
     int low=1,high=starts.Count-1;selected=high;
     while(low<=high){int mid=(low+high)/2;int n=await count(build(starts[mid]))+imageCost(starts[mid]);if(n+reserve<=capacity){selected=mid;high=mid-1;}else low=mid+1;}
     messages=build(starts[selected]);tokens=await count(messages)+imageCost(starts[selected]);
     if(tokens+reserve>capacity)throw new Exception("Your latest message and system prompt exceed the context window. Shorten them, choose a shorter response length, or increase the context size in Settings.");
    }
    try{
     var models=json.Deserialize<Dictionary<string,object>>(await client.GetStringAsync(endpoint+"/v1/models"));
     var list=models.ContainsKey("data")?models["data"] as IList:null;
     if(list!=null)foreach(var entry in list){var item=entry as Dictionary<string,object>;var meta=item!=null&&item.ContainsKey("meta")?item["meta"] as Dictionary<string,object>:null;if(meta!=null&&meta.ContainsKey("n_ctx_train"))trained=Convert.ToInt32(meta["n_ctx_train"]);}
    }catch(Exception){if(ct.IsCancellationRequested)throw;}
    int omitted=starts[selected];
    AttachImages(messages,recent,starts[selected],chat,images);
    Emit(id,"context",new ContextInfo{Prompt=tokens,Generated=0,Capacity=capacity,ModelCapacity=trained,Reserved=reserve,OmittedMessages=omitted,Final=false});
    var result=await StreamCompletion(server,RequestBody(messages,reserve,temperature,thinking),ct,600000,
     piece=>{text.Append(piece);Emit(id,"chunk",piece);},
     thought=>{reasoning.Append(thought);Emit(id,"reasoning",thought);},
     (prompt,generated)=>Emit(id,"context",new ContextInfo{Prompt=prompt>0?prompt:tokens,Generated=generated,Capacity=capacity,ModelCapacity=trained,Reserved=reserve,OmittedMessages=omitted,Final=true}));
    if(text.Length==0&&reasoning.Length>0&&result.Finish=="length")throw new Exception("The response length ran out while the model was thinking. Choose a longer response length in Settings → Chat behavior.");
    complete=true;
   }
  }finally{
   if(text.Length>0){chat.Messages.Add(new ChatMessage{Role="assistant",Content=text.ToString(),Interrupted=!complete});saveMethod.Invoke(null,new object[]{chat});Emit(id,"saved",chat);}
  }
  return chat;
 }
}
