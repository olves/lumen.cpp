// lumen-updater: installs a downloaded Lumen update after the app has quit, then starts Lumen again.
// Lumen copies this program to %TEMP% and starts it with:
//   --pid <app pid> --mode zip|setup --file <download> --sha256 <hex> --target <app folder> --exe <lumen.cpp.exe>
//   --log <log file> --lang en|tr [--arg <relaunch argument>]...
// zip:   the portable ZIP is extracted next to the app folder, the folders are swapped (the old one is restored if anything
//        fails) and the old folder is removed. User data lives elsewhere (%LOCALAPPDATA%\lumen.cpp) and is not touched.
// setup: the signed-off setup is run silently into the same folder (Inno Setup keeps the uninstaller and shortcuts).
// The SHA-256 is checked again here, right before anything is changed.
// Build (.NET Framework 4.8 csc):
//   csc /nologo /target:winexe /out:lumen-updater.exe /r:System.IO.Compression.dll /r:System.IO.Compression.FileSystem.dll
//       /r:System.Windows.Forms.dll LumenUpdater.cs
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Windows.Forms;

static class LumenUpdater {
  static string logPath;
  static bool turkish;

  static void Log(string message) {
    try { if (logPath != null) File.AppendAllText(logPath, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " [updater] " + message + Environment.NewLine, Encoding.UTF8); } catch { }
  }

  [STAThread]
  static int Main(string[] argv) {
    var args = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
    var relaunch = new List<string>();
    for (int i = 0; i + 1 < argv.Length; i += 2) {
      if (argv[i] == "--arg") relaunch.Add(argv[i + 1]); else args[argv[i].TrimStart('-')] = argv[i + 1];
    }
    string value;
    logPath = args.TryGetValue("log", out value) ? value : null;
    turkish = args.TryGetValue("lang", out value) && value == "tr";
    string target = null, exe = "lumen.cpp.exe";
    try {
      int pid = int.Parse(args["pid"]);
      string mode = args["mode"], file = args["file"], sha = args["sha256"].ToLowerInvariant();
      target = Path.GetFullPath(args["target"].TrimEnd('\\'));
      if (args.TryGetValue("exe", out value) && value.IndexOfAny(Path.GetInvalidFileNameChars()) < 0) exe = value;
      if (mode != "zip" && mode != "setup") throw new Exception("Unknown mode.");
      Log("start: mode=" + mode + " target=" + target);

      WaitForExit(pid, target);
      if (Sha256(file) != sha) throw new Exception(T("The update file does not match its checksum. Nothing was changed.", "Güncelleme dosyası doğrulanamadı. Hiçbir şey değiştirilmedi."));

      if (mode == "zip") InstallZip(file, target, exe);
      else RunSetup(file, target);

      Log("installed; starting " + exe);
      Start(Path.Combine(target, exe), target, relaunch);
      return 0;
    } catch (Exception e) {
      Log("failed: " + e);
      MessageBox.Show(T("Lumen could not be updated: ", "Lumen güncellenemedi: ") + e.Message + "\n\n" + T("Your current version is unchanged. You can also download the new version from GitHub.", "Mevcut sürümünüz değişmedi. Yeni sürümü GitHub'dan da indirebilirsiniz."), "lumen.cpp", MessageBoxButtons.OK, MessageBoxIcon.Warning);
      try { if (target != null && File.Exists(Path.Combine(target, exe))) Start(Path.Combine(target, exe), target, relaunch); } catch { }
      return 1;
    }
  }

  static string T(string en, string tr) { return turkish ? tr : en; }

  // Waits for Lumen and anything still running from its folder (engine host) to exit.
  static void WaitForExit(int pid, string target) {
    try { var p = Process.GetProcessById(pid); if (!p.WaitForExit(120000)) throw new Exception(T("Lumen did not close.", "Lumen kapanmadı.")); } catch (ArgumentException) { }
    string prefix = target + "\\";
    for (int attempt = 0; attempt < 60; attempt++) {
      var running = Process.GetProcesses().Where(p => { try { return p.MainModule.FileName.StartsWith(prefix, StringComparison.OrdinalIgnoreCase); } catch { return false; } }).ToList();
      if (running.Count == 0) return;
      if (attempt == 30) foreach (var p in running) { Log("stopping " + p.ProcessName + " " + p.Id); try { p.Kill(); } catch { } }
      Thread.Sleep(500);
    }
    throw new Exception(T("Some Lumen processes are still running.", "Bazı Lumen işlemleri hâlâ çalışıyor."));
  }

  static string Sha256(string file) {
    using (var sha = SHA256.Create()) using (var stream = File.OpenRead(file))
      return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "").ToLowerInvariant();
  }

  static void InstallZip(string zip, string target, string exe) {
    string stamp = DateTime.Now.ToString("yyyyMMddHHmmss"), fresh = target + ".new-" + stamp, old = target + ".old-" + stamp;
    Directory.CreateDirectory(fresh);
    string freshRoot = Path.GetFullPath(fresh) + "\\";
    using (var archive = ZipFile.OpenRead(zip)) {
      var names = archive.Entries.Select(e => e.FullName.Replace('\\', '/')).ToList();
      // The release ZIP has one top folder (Lumen-Beta/); it is dropped so its contents become the app folder.
      string first = names.Count > 0 && names[0].Contains("/") ? names[0].Substring(0, names[0].IndexOf('/') + 1) : "";
      string strip = first.Length > 0 && names.All(n => n.StartsWith(first, StringComparison.Ordinal)) ? first : "";
      foreach (var entry in archive.Entries) {
        string name = entry.FullName.Replace('\\', '/').Substring(strip.Length);
        if (name.Length == 0) continue;
        string dest = Path.GetFullPath(Path.Combine(fresh, name.Replace('/', '\\')));
        if (!dest.StartsWith(freshRoot, StringComparison.OrdinalIgnoreCase)) throw new Exception("Unsafe path in the update: " + entry.FullName);
        if (name.EndsWith("/")) { Directory.CreateDirectory(dest); continue; }
        Directory.CreateDirectory(Path.GetDirectoryName(dest));
        entry.ExtractToFile(dest, true);
      }
    }
    if (!File.Exists(Path.Combine(fresh, exe)) || !File.Exists(Path.Combine(fresh, "resources\\app\\main.cjs"))) {
      TryDelete(fresh); throw new Exception(T("The update does not contain Lumen.", "Güncelleme Lumen dosyalarını içermiyor."));
    }
    Retry(() => Directory.Move(target, old), "moving the current version aside");
    try { Retry(() => Directory.Move(fresh, target), "moving the new version into place"); }
    catch { Log("restoring the previous version"); Directory.Move(old, target); TryDelete(fresh); throw; }
    TryDelete(old);
  }

  static void RunSetup(string setup, string target) {
    var info = new ProcessStartInfo(setup, "/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP- /DIR=\"" + target + "\"") { UseShellExecute = false, WorkingDirectory = Path.GetTempPath() };
    using (var p = Process.Start(info)) {
      if (!p.WaitForExit(15 * 60000)) throw new Exception(T("The setup did not finish.", "Kurulum bitmedi."));
      Log("setup exit code " + p.ExitCode);
      if (p.ExitCode != 0) throw new Exception(T("The setup ended with code ", "Kurulum şu kodla bitti: ") + p.ExitCode + ".");
    }
  }

  static void Start(string program, string folder, List<string> args) {
    var info = new ProcessStartInfo(program, string.Join(" ", args.Select(Quote))) { UseShellExecute = false, WorkingDirectory = folder };
    Process.Start(info);
  }

  static string Quote(string arg) {
    if (arg.Length > 0 && arg.IndexOfAny(new[] { ' ', '\t', '"' }) < 0) return arg;
    var s = new StringBuilder("\"");
    int slashes = 0;
    foreach (char c in arg) {
      if (c == '\\') { slashes++; continue; }
      if (c == '"') { s.Append('\\', slashes * 2 + 1); s.Append('"'); } else { s.Append('\\', slashes); s.Append(c); }
      slashes = 0;
    }
    s.Append('\\', slashes * 2); s.Append('"');
    return s.ToString();
  }

  static void Retry(Action action, string what) {
    for (int i = 0; ; i++) {
      try { action(); return; }
      catch (Exception e) { if (i >= 20) throw new Exception(T("Windows did not allow ", "Windows izin vermedi: ") + what + " (" + e.Message + ")"); Thread.Sleep(500); }
    }
  }

  static void TryDelete(string folder) {
    for (int i = 0; i < 10; i++) { try { if (Directory.Exists(folder)) Directory.Delete(folder, true); return; } catch { Thread.Sleep(500); } }
    Log("could not remove " + folder + "; Lumen removes it on a later start");
  }
}
