// Lumen core: chats, model catalog, Hugging Face listing, hardware scan and llama.cpp engine setup. This replaces the closed
// lumen-core-beta.exe of the early betas. Behavior, error texts and every file it writes (chats/*.json, catalog.json,
// engine-preferences.json, runtime/b11438/<engine>/ready.json) match that backend so existing user data keeps working; the
// parity tests in work/test-core-parity.mjs compare both. Compiled together with LumenHost.cs (see there).
using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Management;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using Microsoft.Win32;

namespace Lumen {
 // Field order is the JSON order on disk; keep it.
 public class ChatMessage{public string Role;public string Content;public bool Interrupted;}
 public class Conversation{
  public string Id=Guid.NewGuid().ToString("N");public string Title="New chat";public string Model="Qwen2.5 1.5B";
  public string SystemPrompt="You are a helpful assistant. Respond in the user's language. Be clear and accurate.";
  public string Updated=DateTimeOffset.Now.ToString("o");public List<ChatMessage> Messages=new List<ChatMessage>();
 }
 public class CatalogModel{public string Name;public string Repo;public string File;public string Sha;public long Bytes;public string LocalFile;}
 public class CatalogEntry{public string Name;public string Repo;public string File;public string Sha;public long Bytes;public string LocalFile;public bool Installed;}
 public class Hardware{public string Cpu;public string Gpu;public double Ram;public double Available;public double Vram;public int Threads;}
 public class BackendPreferences{public bool SetupDone;public string Backend="cpu";}
 public class BackendPlan{public bool SetupDone;public bool Installed;public string Recommended;public string Gpu;public string Driver;public string Compute;public string Selected;public long Bytes;}
 public class BackendProgress{public string Phase;public string File;public long Bytes;public long Total;public double Speed;public double Percent;}
 public class ContextInfo{public int Prompt;public int Generated;public int Capacity;public int ModelCapacity;public int Reserved;public int OmittedMessages;public bool Final;}

 public static class Core {
  public static string Data=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"lumen.cpp");
  public static readonly JavaScriptSerializer Json=new JavaScriptSerializer{MaxJsonLength=16000000};
  // The three starter models come first; models.catalog.json (next to the executable) and the user's catalog.json follow.
  public static readonly List<CatalogModel> Catalog=new List<CatalogModel>{
   new CatalogModel{Name="Qwen2.5 0.5B",Repo="Qwen/Qwen2.5-0.5B-Instruct-GGUF",File="qwen2.5-0.5b-instruct-q4_k_m.gguf",Bytes=491400032,Sha="74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db"},
   new CatalogModel{Name="Qwen2.5 1.5B",Repo="Qwen/Qwen2.5-1.5B-Instruct-GGUF",File="qwen2.5-1.5b-instruct-q4_k_m.gguf",Bytes=1117320736,Sha="6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e"},
   new CatalogModel{Name="Qwen2.5 3B",Repo="Qwen/Qwen2.5-3B-Instruct-GGUF",File="qwen2.5-3b-instruct-q4_k_m.gguf",Bytes=2104932768,Sha="626b4a6678b86442240e33df819e00132d3ba7dddfe1cdc4fbb18e0a9615c62d"}
  };
  public static string AppFolder{get{return AppDomain.CurrentDomain.BaseDirectory;}}
  public static string ModelPath(CatalogModel m){return Path.Combine(Data,"models",string.IsNullOrWhiteSpace(m.LocalFile)?m.File:m.LocalFile);}
  public static bool Installed(CatalogModel m){string path=ModelPath(m);return File.Exists(path)&&new FileInfo(path).Length==m.Bytes;}
  public static List<CatalogEntry> Entries(){return Catalog.Select(m=>new CatalogEntry{Name=m.Name,Repo=m.Repo,File=m.File,Sha=m.Sha,Bytes=m.Bytes,LocalFile=m.LocalFile,Installed=Installed(m)}).ToList();}
  public static string Sha256(string file){using(var stream=File.OpenRead(file))using(var sha=SHA256.Create())return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-","").ToLowerInvariant();}
  // Writes next to the target and swaps it in, so a crash never leaves half a file.
  public static void WriteAtomic(string path,string text,Encoding encoding){
   string temp=path+".tmp";if(encoding==null)File.WriteAllText(temp,text);else File.WriteAllText(temp,text,encoding);
   if(File.Exists(path))File.Replace(temp,path,null);else File.Move(temp,path);
  }
 }

 public static class ChatStore {
  public static string Folder{get{return Path.Combine(Core.Data,"chats");}}
  public static List<Conversation> Load(){
   var list=new List<Conversation>();
   if(Directory.Exists(Folder))foreach(var file in Directory.GetFiles(Folder,"*.json")){
    try{var chat=Core.Json.Deserialize<Conversation>(File.ReadAllText(file));if(chat!=null&&chat.Messages!=null)list.Add(chat);}catch{}
   }
   return list.OrderByDescending(c=>c.Updated).ToList();
  }
  public static void Save(Conversation chat){
   Directory.CreateDirectory(Folder);chat.Updated=DateTimeOffset.Now.ToString("o");
   Core.WriteAtomic(Path.Combine(Folder,chat.Id+".json"),Core.Json.Serialize(chat),Encoding.UTF8);
  }
  public static bool Delete(string id){
   if(!Regex.IsMatch(id??"","^[a-fA-F0-9]{32}$"))throw new ArgumentException("Invalid conversation ID.");
   string path=Path.Combine(Folder,id+".json");if(!File.Exists(path))return false;File.Delete(path);return true;
  }
  public static Conversation Branch(Conversation chat,int count){
   return new Conversation{Title=chat.Title+" / branch",Model=chat.Model,SystemPrompt=chat.SystemPrompt,Messages=chat.Messages.Take(count).Select(m=>new ChatMessage{Role=m.Role,Content=m.Content,Interrupted=m.Interrupted}).ToList()};
  }
 }

 public static class ModelDirectory {
  static bool Known(CatalogModel m){return Core.Catalog.Any(c=>c.Sha==m.Sha);}
  public static void Load(){
   string bundled=Path.Combine(Core.AppFolder,"models.catalog.json");
   if(File.Exists(bundled))foreach(var m in Core.Json.Deserialize<List<CatalogModel>>(File.ReadAllText(bundled)))if(!Known(m))Core.Catalog.Add(m);
   try{
    foreach(var m in Core.Json.Deserialize<List<CatalogModel>>(File.ReadAllText(Path.Combine(Core.Data,"catalog.json")))){
     if(Known(m)||!Regex.IsMatch(m.Sha??"","^[a-f0-9]{64}$")||string.IsNullOrWhiteSpace(m.Repo)||m.Bytes<=0)continue;
     m.LocalFile=m.Sha.Substring(0,12)+"-"+Path.GetFileName(m.File);Core.Catalog.Add(m);
    }
   }catch{}
  }
  public static void Register(CatalogModel m){
   if(!Known(m))Core.Catalog.Add(m);
   Directory.CreateDirectory(Core.Data);File.WriteAllText(Path.Combine(Core.Data,"catalog.json"),Core.Json.Serialize(Core.Catalog),Encoding.UTF8);
  }
  public static async Task<List<string>> Search(string query,CancellationToken ct){
   using(var client=new HttpClient{Timeout=TimeSpan.FromSeconds(25)}){
    string text=await client.GetStringAsync("https://huggingface.co/api/models?search="+Uri.EscapeDataString(query)+"&filter=gguf&sort=downloads&direction=-1&limit=40");
    ct.ThrowIfCancellationRequested();
    return Core.Json.Deserialize<List<Dictionary<string,object>>>(text).Select(e=>Convert.ToString(e["id"])).ToList();
   }
  }
  // Single-file GGUF weights with an LFS SHA-256. Vision projectors and split files are left out.
  public static async Task<List<CatalogModel>> Files(string repo,CancellationToken ct){
   using(var client=new HttpClient{Timeout=TimeSpan.FromSeconds(30)}){
    string text=await client.GetStringAsync("https://huggingface.co/api/models/"+repo+"?blobs=true");
    ct.ThrowIfCancellationRequested();
    var data=Core.Json.Deserialize<Dictionary<string,object>>(text);var list=new List<CatalogModel>();
    foreach(var item in (IEnumerable)data["siblings"]){
     var entry=(Dictionary<string,object>)item;string name=Convert.ToString(entry["rfilename"]);
     if(!name.EndsWith(".gguf",StringComparison.OrdinalIgnoreCase)||name.ToLowerInvariant().Contains("mmproj")||Regex.IsMatch(name,@"-\d{5}-of-\d{5}"))continue;
     if(!entry.ContainsKey("lfs"))continue;var lfs=(Dictionary<string,object>)entry["lfs"];string sha=Convert.ToString(lfs["sha256"]);
     if(!Regex.IsMatch(sha,"^[a-f0-9]{64}$"))continue;
     list.Add(new CatalogModel{Name=repo+" / "+name,Repo=repo,File=name,Bytes=Convert.ToInt64(lfs["size"]),Sha=sha,LocalFile=sha.Substring(0,12)+"-"+Path.GetFileName(name)});
    }
    return list;
   }
  }
  // The original sequential model download. Lumen now downloads models in the main process (downloader.cjs); this stays for
  // the "download" action of older interface code.
  public static async Task Download(CatalogModel m,Action<string,double> progress,CancellationToken ct){
   Directory.CreateDirectory(Path.Combine(Core.Data,"models"));string path=Core.ModelPath(m);
   if(File.Exists(path)&&new FileInfo(path).Length==m.Bytes)return;
   string partial=path+".partial";long offset=File.Exists(partial)?new FileInfo(partial).Length:0;
   if(offset>m.Bytes){File.Delete(partial);offset=0;}
   if(new DriveInfo(Path.GetPathRoot(Path.GetFullPath(path))).AvailableFreeSpace<m.Bytes-offset+536870912L)throw new Exception("Model için yeterli boş disk alanı yok.");
   using(var client=new HttpClient{Timeout=Timeout.InfiniteTimeSpan})
   using(var request=new HttpRequestMessage(HttpMethod.Get,"https://huggingface.co/"+m.Repo+"/resolve/main/"+m.File)){
    if(offset>0)request.Headers.Range=new RangeHeaderValue(offset,null);
    using(var response=await client.SendAsync(request,HttpCompletionOption.ResponseHeadersRead,ct)){
     response.EnsureSuccessStatusCode();if(response.StatusCode!=HttpStatusCode.PartialContent)offset=0;
     using(var input=await response.Content.ReadAsStreamAsync())
     using(ct.Register(()=>input.Dispose()))
     using(var output=new FileStream(partial,offset>0?FileMode.Append:FileMode.Create,FileAccess.Write,FileShare.None,81920,true)){
      var buffer=new byte[81920];var tick=Stopwatch.StartNew();int n;
      while((n=await input.ReadAsync(buffer,0,buffer.Length,ct))>0){
       await output.WriteAsync(buffer,0,n,ct);offset+=n;
       if(tick.ElapsedMilliseconds>=150){progress("Model indiriliyor · "+(offset/1048576)+" / "+(m.Bytes/1048576)+" MB",Math.Min(99,100.0*offset/m.Bytes));tick.Restart();}
      }
     }
    }
   }
   progress("Model bütünlüğü doğrulanıyor",99);
   string digest=await Task.Run(()=>Core.Sha256(partial),ct);ct.ThrowIfCancellationRequested();
   if(new FileInfo(partial).Length!=m.Bytes||digest!=m.Sha){File.Delete(partial);throw new Exception("Model doğrulaması başarısız. Yeniden indirmeyi dene.");}
   if(File.Exists(path))File.Delete(path);File.Move(partial,path);
   progress("Model hazır",100);
  }
 }

 public static class HardwareScan {
  [StructLayout(LayoutKind.Sequential)] class Memory{public uint Length=(uint)Marshal.SizeOf(typeof(Memory));public uint Load;public ulong Total,Free,PageTotal,PageFree,VirtualTotal,VirtualFree,Extended;}
  [DllImport("kernel32.dll",SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] static extern bool GlobalMemoryStatusEx([In,Out] Memory memory);
  public static Hardware Scan(){
   var h=new Hardware();var memory=new Memory();
   if(GlobalMemoryStatusEx(memory)){h.Ram=memory.Total/1073741824.0;h.Available=memory.Free/1073741824.0;}
   try{
    using(var searcher=new ManagementObjectSearcher("SELECT Name,NumberOfLogicalProcessors FROM Win32_Processor"))
    foreach(ManagementObject cpu in searcher.Get()){h.Cpu=Convert.ToString(cpu["Name"]).Trim();h.Threads+=Convert.ToInt32(cpu["NumberOfLogicalProcessors"]);}
   }catch{
    using(var key=Registry.LocalMachine.OpenSubKey(@"HARDWARE\DESCRIPTION\System\CentralProcessor\0"))if(key!=null)h.Cpu=Convert.ToString(key.GetValue("ProcessorNameString","Bilinmiyor")).Trim();
    h.Threads=Environment.ProcessorCount;
   }
   var gpus=new List<string>();
   try{
    using(var searcher=new ManagementObjectSearcher("SELECT Name FROM Win32_VideoController"))
    foreach(ManagementObject gpu in searcher.Get())gpus.Add(Convert.ToString(gpu["Name"]));
   }catch{
    try{
     using(var display=Registry.LocalMachine.OpenSubKey(@"SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}"))
     if(display!=null)foreach(string name in display.GetSubKeyNames()){
      try{using(var key=display.OpenSubKey(name)){var desc=key!=null?key.GetValue("DriverDesc"):null;if(desc!=null)gpus.Add(Convert.ToString(desc));}}catch{}
     }
    }catch{}
   }
   h.Gpu=gpus.Count>0?string.Join(" / ",gpus.Distinct()):"GPU adı okunamadı";
   try{
    using(var p=new Process{StartInfo=new ProcessStartInfo(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System),"nvidia-smi.exe"),"--query-gpu=name,memory.total --format=csv,noheader,nounits"){UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,RedirectStandardError=true}}){
     p.Start();
     if(p.WaitForExit(4000)){
      foreach(string line in p.StandardOutput.ReadToEnd().Trim().Split('\n')){
       var parts=line.Split(',');double mib;
       if(parts.Length>=2&&double.TryParse(parts.Last().Trim(),System.Globalization.NumberStyles.Float|System.Globalization.NumberStyles.AllowThousands,System.Globalization.CultureInfo.InvariantCulture,out mib))h.Vram=Math.Max(h.Vram,mib/1024);
      }
     }else p.Kill();
    }
   }catch{}
   return h;
  }
 }

 // llama.cpp engines. CPU and Vulkan come with Lumen (backend/engines/llama-<engine>.zip, the official b11438 archives) and
 // are unpacked into <data>/runtime/b11438/<engine> on first use. CUDA builds are downloaded from the official release with a
 // fixed size and SHA-256, unpacked into a staging folder and tested with --list-devices before they are used.
 public static class BackendManager {
  public const string Release="b11438";
  public static string Settings{get{return Path.Combine(Core.Data,"engine-preferences.json");}}
  public static BackendPreferences Preferences(){
   try{return Core.Json.Deserialize<BackendPreferences>(File.ReadAllText(Settings))??new BackendPreferences();}catch{return new BackendPreferences();}
  }
  public static void Save(string backend){Directory.CreateDirectory(Core.Data);Core.WriteAtomic(Settings,Core.Json.Serialize(new BackendPreferences{SetupDone=true,Backend=backend}),null);}
  public static string Select(string driver,string compute,bool nvidia){
   double d,c;var style=System.Globalization.NumberStyles.Float|System.Globalization.NumberStyles.AllowThousands;var culture=System.Globalization.CultureInfo.InvariantCulture;
   if(!nvidia||!double.TryParse(driver,style,culture,out d)||!double.TryParse(compute,style,culture,out c))return "vulkan";
   if(d>=580&&c>=7.5)return "cuda13";
   if(d>=551.61&&c>=6&&c<=9)return "cuda12";
   return "vulkan";
  }
  public static BackendPlan Plan(Hardware h){
   string driver="",compute="",gpu=h.Gpu;
   try{
    using(var p=new Process{StartInfo=new ProcessStartInfo(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System),"nvidia-smi.exe"),"--query-gpu=name,driver_version,compute_cap --format=csv,noheader,nounits"){UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,RedirectStandardError=true}}){
     p.Start();var output=p.StandardOutput.ReadToEndAsync();p.BeginErrorReadLine();
     if(!p.WaitForExit(4000))p.Kill();
     else if(p.ExitCode==0){var parts=output.Result.Split('\n')[0].Split(',');if(parts.Length==3){gpu=parts[0].Trim();driver=parts[1].Trim();compute=parts[2].Trim();}}
    }
   }catch{}
   var preferences=Preferences();
   string recommended=Select(driver,compute,(gpu??"").IndexOf("NVIDIA",StringComparison.OrdinalIgnoreCase)>=0);
   if(gpu=="Bilinmiyor"||string.IsNullOrWhiteSpace(gpu))recommended="cpu";
   return new BackendPlan{SetupDone=preferences.SetupDone,Selected=preferences.Backend,Recommended=recommended,Gpu=gpu,Driver=driver,Compute=compute,Installed=Ready(recommended),
    Bytes=recommended=="cuda13"?576625007L:recommended=="cuda12"?655917217L:0};
  }
  public static string Folder(string backend){return Path.Combine(Core.Data,"runtime",Release,backend);}
  public static bool Ready(string backend){
   if(backend=="cpu"||backend=="vulkan")return true;
   if(backend=="cuda13"||backend=="cuda12")return File.Exists(Path.Combine(Folder(backend),"ready.json"))&&File.Exists(Path.Combine(Folder(backend),"llama-server.exe"));
   return false;
  }
  public static string Executable(string backend){return backend=="cpu"||backend=="vulkan"?Extract(backend):Path.Combine(Folder(backend),"llama-server.exe");}
  // Unpacks a bundled engine once. Entries may not leave the target folder.
  public static string Extract(string kind){
   string folder=Folder(kind),exe=Path.Combine(folder,"llama-server.exe");
   if(!File.Exists(exe)){
    string archive=Path.Combine(Core.AppFolder,"engines","llama-"+kind+".zip");
    if(!File.Exists(archive))throw new Exception("Paketin içindeki motor bulunamadı.");
    Directory.CreateDirectory(folder);
    using(var zip=ZipFile.OpenRead(archive))foreach(var entry in zip.Entries){
     string target=Path.GetFullPath(Path.Combine(folder,entry.FullName));
     if(!target.StartsWith(Path.GetFullPath(folder)+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase))throw new Exception("Geçersiz motor paketi yolu.");
     if(string.IsNullOrEmpty(entry.Name)){Directory.CreateDirectory(target);continue;}
     Directory.CreateDirectory(Path.GetDirectoryName(target));
     using(var input=entry.Open())using(var output=File.Create(target))input.CopyTo(output);
    }
   }
   if(File.Exists(exe))return exe;
   var found=Directory.GetFiles(folder,"llama-server.exe",SearchOption.AllDirectories);
   if(found.Length==0)throw new Exception("Motor paketi eksik.");
   return found[0];
  }
  static void ExtractZip(string archive,string folder){
   Directory.CreateDirectory(folder);
   using(var zip=ZipFile.OpenRead(archive))foreach(var entry in zip.Entries){
    string target=Path.GetFullPath(Path.Combine(folder,entry.FullName));
    if(!target.StartsWith(Path.GetFullPath(folder)+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase))throw new Exception("Invalid backend archive path.");
    if(string.IsNullOrEmpty(entry.Name)){Directory.CreateDirectory(target);continue;}
    Directory.CreateDirectory(Path.GetDirectoryName(target));
    using(var input=entry.Open())using(var output=File.Create(target))input.CopyTo(output);
   }
  }
  // One release file into <data>/runtime/downloads, resumed from a .partial file, size and SHA-256 checked before it is kept.
  static async Task<string> Fetch(string name,long size,string sha,long before,long total,Action<BackendProgress> progress,CancellationToken ct){
   string cache=Path.Combine(Core.Data,"runtime","downloads");Directory.CreateDirectory(cache);
   string path=Path.Combine(cache,name),partial=path+".partial";
   if(File.Exists(path)){
    bool good;using(var stream=File.OpenRead(path))using(var hash=SHA256.Create())good=new FileInfo(path).Length==size&&BitConverter.ToString(hash.ComputeHash(stream)).Replace("-","").ToLowerInvariant()==sha;
    if(good)return path;File.Delete(path);
   }
   long offset=File.Exists(partial)?new FileInfo(partial).Length:0;
   if(offset>size){File.Delete(partial);offset=0;}
   var watch=Stopwatch.StartNew();long initial=offset;var tick=Stopwatch.StartNew();
   if(offset<size){
    using(var client=new HttpClient{Timeout=Timeout.InfiniteTimeSpan})
    using(var request=new HttpRequestMessage(HttpMethod.Get,"https://github.com/ggml-org/llama.cpp/releases/download/"+Release+"/"+name)){
     if(offset>0)request.Headers.Range=new RangeHeaderValue(offset,null);
     using(var response=await client.SendAsync(request,HttpCompletionOption.ResponseHeadersRead,ct)){
      response.EnsureSuccessStatusCode();
      if(response.StatusCode==HttpStatusCode.PartialContent){var range=response.Content.Headers.ContentRange;if(range==null||range.From!=offset)throw new Exception("Invalid resumed download.");}
      else{offset=0;initial=0;}
      using(var input=await response.Content.ReadAsStreamAsync())
      using(ct.Register(()=>input.Dispose()))
      using(var output=new FileStream(partial,offset>0?FileMode.Append:FileMode.Create,FileAccess.Write,FileShare.Read,81920,true)){
       var buffer=new byte[81920];int n;
       while((n=await input.ReadAsync(buffer,0,buffer.Length,ct))>0){
        offset+=n;if(offset>size)throw new Exception("Backend download exceeds expected size.");
        await output.WriteAsync(buffer,0,n,ct);
        if(tick.ElapsedMilliseconds>=200){progress(new BackendProgress{Phase="download",File=name,Bytes=before+offset,Total=total,Speed=(offset-initial)/Math.Max(0.1,watch.Elapsed.TotalSeconds),Percent=100.0*(before+offset)/total});tick.Restart();}
       }
      }
     }
    }
   }
   progress(new BackendProgress{Phase="verify",File=name,Bytes=before+size,Total=total,Percent=100.0*(before+size)/total});
   string digest=await Task.Run(()=>Core.Sha256(partial),ct);ct.ThrowIfCancellationRequested();
   if(new FileInfo(partial).Length!=size||digest!=sha){File.Delete(partial);throw new Exception("Backend SHA-256 verification failed. Retry the download.");}
   File.Move(partial,path);return path;
  }
  public static async Task<BackendPlan> Install(string backend,Hardware h,Action<BackendProgress> progress,CancellationToken ct){
   if(!new[]{"cpu","vulkan","cuda12","cuda13"}.Contains(backend))throw new Exception("Invalid backend.");
   if(backend.StartsWith("cuda")&&Plan(h).Recommended!=backend)throw new Exception("This CUDA build is not compatible with the detected driver/GPU.");
   if(!Ready(backend)){
    if(new DriveInfo(Path.GetPathRoot(Path.GetFullPath(Core.Data))).AvailableFreeSpace<2200000000L)throw new Exception("At least 2.2 GB of free space is required.");
    bool modern=backend=="cuda13";long size=modern?153089651L:264473590L,total=modern?576625007L:655917217L;string version=modern?"13.4":"12.4";
    string engine=await Fetch("llama-"+Release+"-bin-win-cuda-"+version+"-x64.zip",size,modern?"f05da20ea7d7cd07166d5bb08fc0319a156a0f439ab5da64b51f1a19818beb3b":"52ef1c9d3215c3b015a4b76d982a8d4add88fc397f2cc4699afbe544d6911771",0,total,progress,ct);
    string runtime=await Fetch("cudart-llama-bin-win-cuda-"+version+"-x64.zip",total-size,modern?"738f8c251ac22b70c3ae6f83a10cf222725df0395246a2cf58f32bdb85fbe668":"8c79a9b226de4b3cacfd1f83d24f962d0773be79f1e7b75c6af4ded7e32ae1d6",size,total,progress,ct);
    ct.ThrowIfCancellationRequested();
    progress(new BackendProgress{Phase="extract",Total=total,Bytes=total,Percent=100});
    string staging=Folder(backend)+".staging";if(Directory.Exists(staging))Directory.Delete(staging,true);
    try{
     await Task.Run(()=>{ExtractZip(engine,staging);ExtractZip(runtime,staging);},ct);
     ct.ThrowIfCancellationRequested();
     string exe=Directory.GetFiles(staging,"llama-server.exe",SearchOption.AllDirectories).Single(),parent=Path.GetDirectoryName(exe);
     foreach(string dll in Directory.GetFiles(staging,"*.dll",SearchOption.AllDirectories)){string target=Path.Combine(parent,Path.GetFileName(dll));if(!string.Equals(dll,target,StringComparison.OrdinalIgnoreCase))File.Copy(dll,target,true);}
     await Probe(exe,"CUDA",ct);
     if(parent!=staging)throw new Exception("Unexpected backend archive structure.");
     File.WriteAllText(Path.Combine(staging,"ready.json"),Core.Json.Serialize(new Dictionary<string,object>{{"release",Release},{"backend",backend},{"verified",true}}));
     if(Directory.Exists(Folder(backend)))Directory.Delete(Folder(backend),true);
     Directory.Move(staging,Folder(backend));
    }finally{if(Directory.Exists(staging))Directory.Delete(staging,true);}
   }
   if(backend=="vulkan")await Probe(Executable("vulkan"),"Vulkan",ct);
   ct.ThrowIfCancellationRequested();
   Save(backend);return Plan(h);
  }
  // llama-server --list-devices must list a device of this kind ("CUDA0:", "Vulkan0:") within 25 s.
  static async Task Probe(string exe,string kind,CancellationToken ct){
   var text=new StringBuilder();
   using(var p=new Process{StartInfo=new ProcessStartInfo(exe,"--list-devices"){WorkingDirectory=Path.GetDirectoryName(exe),UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,RedirectStandardError=true}}){
    DataReceivedEventHandler collect=(s,e)=>{if(e.Data!=null)lock(text)text.AppendLine(e.Data);};
    p.OutputDataReceived+=collect;p.ErrorDataReceived+=collect;
    try{
     p.Start();p.BeginOutputReadLine();p.BeginErrorReadLine();var timer=Stopwatch.StartNew();
     while(!p.HasExited){ct.ThrowIfCancellationRequested();if(timer.Elapsed.TotalSeconds>25)throw new Exception("GPU verification timed out.");await Task.Delay(100,ct);}
     p.WaitForExit();string output;lock(text)output=text.ToString();
     if(p.ExitCode!=0||!Regex.IsMatch(output,kind+@"\d+:",RegexOptions.IgnoreCase))throw new Exception("No usable "+kind+" GPU detected. Continue with CPU or retry after updating your driver.");
    }finally{try{if(!p.HasExited)p.Kill();}catch{}}
   }
  }
 }

 // A running llama-server: loopback only, a random port and API key, its log and whether it offloaded layers to the GPU.
 public class NativeServer : IDisposable {
  public Process process;public string endpoint;public string key;public string log="";public string Backend="cpu";public bool gpuActive;bool disposed;
  public static readonly HashSet<NativeServer> live=new HashSet<NativeServer>();
  static NativeServer(){AppDomain.CurrentDomain.ProcessExit+=(s,e)=>{NativeServer[] all;lock(live)all=live.ToArray();foreach(var server in all)server.Dispose();};}
  public bool GpuActive{get{lock(this)return gpuActive;}}
  public void Dispose(){
   lock(this){if(disposed)return;disposed=true;}
   lock(live)live.Remove(this);
   try{if(process!=null&&!process.HasExited){process.Kill();process.WaitForExit(3000);}if(process!=null)process.Dispose();}catch{}
  }
  async Task<Dictionary<string,object>> PostJson(HttpClient client,string route,object body,CancellationToken ct){
   using(var response=await client.PostAsync(endpoint+route,new StringContent(Core.Json.Serialize(body),Encoding.UTF8,"application/json"),ct)){
    string text=await response.Content.ReadAsStringAsync();if(!response.IsSuccessStatusCode)throw new Exception(text);
    return Core.Json.Deserialize<Dictionary<string,object>>(text);
   }
  }
  // Prompt tokens for these messages through the model's own chat template and tokenizer.
  public async Task<int> Count(HttpClient client,List<object> messages,CancellationToken ct){
   var template=await PostJson(client,"/apply-template",new Dictionary<string,object>{{"messages",messages},{"chat_template_kwargs",new Dictionary<string,object>{{"enable_thinking",false}}}},ct);
   var tokens=await PostJson(client,"/tokenize",new Dictionary<string,object>{{"content",template["prompt"]},{"add_special",true},{"parse_special",true}},ct);
   return ((ICollection)tokens["tokens"]).Count;
  }
  // The system prompt, then the kept messages from index on.
  public List<object> PromptMessages(Conversation chat,List<ChatMessage> recent,int index){
   var list=new List<object>();
   if(!string.IsNullOrWhiteSpace(chat.SystemPrompt))list.Add(new Dictionary<string,object>{{"role","system"},{"content",chat.SystemPrompt}});
   foreach(var m in recent.Skip(index))list.Add(new Dictionary<string,object>{{"role",m.Role},{"content",m.Content}});
   return list;
  }
 }

 // The loaded model: one llama-server at a time (--parallel 1).
 public class ChatSession {
  public NativeServer server;public string loaded;public int loadedContext;
  public void Dispose(){if(server!=null)server.Dispose();server=null;loaded=null;}
 }
}
