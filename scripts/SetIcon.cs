// Build tool (not shipped): writes an .ico file into an .exe as its main icon, so Explorer, the taskbar and Task Manager show
// the Lumen icon instead of Electron's. Uses the Windows resource update API (kernel32 BeginUpdateResource / UpdateResource).
//   SetIcon.exe <exe> <ico>
// The exe's first icon group (RT_GROUP_ICON) is replaced in place, with the same name and language, so Windows picks the new
// icon. Its images (RT_ICON) are written under new ids above the exe's highest one; the old images stay unreferenced.
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;

static class SetIcon {
  const int RT_ICON = 3, RT_GROUP_ICON = 14;
  const uint LOAD_LIBRARY_AS_DATAFILE = 0x2;

  delegate bool EnumNameProc(IntPtr module, IntPtr type, IntPtr name, IntPtr param);
  delegate bool EnumLangProc(IntPtr module, IntPtr type, IntPtr name, ushort lang, IntPtr param);
  [DllImport("kernel32", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr LoadLibraryEx(string file, IntPtr reserved, uint flags);
  [DllImport("kernel32", SetLastError = true)] static extern bool FreeLibrary(IntPtr module);
  [DllImport("kernel32", SetLastError = true)] static extern bool EnumResourceNames(IntPtr module, IntPtr type, EnumNameProc proc, IntPtr param);
  [DllImport("kernel32", SetLastError = true)] static extern bool EnumResourceLanguages(IntPtr module, IntPtr type, IntPtr name, EnumLangProc proc, IntPtr param);
  [DllImport("kernel32", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr BeginUpdateResource(string file, bool deleteExisting);
  [DllImport("kernel32", SetLastError = true)] static extern bool UpdateResource(IntPtr update, IntPtr type, IntPtr name, ushort lang, byte[] data, uint size);
  [DllImport("kernel32", SetLastError = true)] static extern bool EndUpdateResource(IntPtr update, bool discard);

  static bool IsIntResource(IntPtr p) { return ((ulong)p.ToInt64() >> 16) == 0; }

  static int Main(string[] args) {
    if (args.Length != 2) { Console.Error.WriteLine("Usage: SetIcon <exe> <ico>"); return 2; }
    string exe = Path.GetFullPath(args[0]), ico = Path.GetFullPath(args[1]);
    try { Run(exe, ico); Console.WriteLine("Icon set: " + exe); return 0; }
    catch (Exception e) { Console.Error.WriteLine("SetIcon failed: " + e.Message); return 1; }
  }

  static void Run(string exe, string ico) {
    byte[] file = File.ReadAllBytes(ico);
    if (file.Length < 6 || BitConverter.ToUInt16(file, 0) != 0 || BitConverter.ToUInt16(file, 2) != 1) throw new InvalidDataException("Not an .ico file.");
    int count = BitConverter.ToUInt16(file, 4);
    if (count < 1 || 6 + count * 16 > file.Length) throw new InvalidDataException("The .ico file has no images.");

    // The exe's first icon group (name: integer id or string), its language, and the highest RT_ICON id in use.
    IntPtr groupName = IntPtr.Zero; string groupString = null; ushort lang = 0; bool haveLang = false; int maxIcon = 0;
    IntPtr module = LoadLibraryEx(exe, IntPtr.Zero, LOAD_LIBRARY_AS_DATAFILE);
    if (module == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error(), "Cannot open " + exe);
    try {
      EnumResourceNames(module, (IntPtr)RT_GROUP_ICON, (m, t, n, p) => {
        if (IsIntResource(n)) groupName = n; else groupString = Marshal.PtrToStringUni(n);
        return false; // the first group only
      }, IntPtr.Zero);
      if (groupName == IntPtr.Zero && groupString == null) throw new InvalidDataException("The exe has no icon group.");
      IntPtr nameForLang = groupString != null ? Marshal.StringToHGlobalUni(groupString) : groupName;
      try {
        EnumResourceLanguages(module, (IntPtr)RT_GROUP_ICON, nameForLang, (m, t, n, l, p) => { lang = l; haveLang = true; return false; }, IntPtr.Zero);
      } finally { if (groupString != null) Marshal.FreeHGlobal(nameForLang); }
      EnumResourceNames(module, (IntPtr)RT_ICON, (m, t, n, p) => { if (IsIntResource(n)) maxIcon = Math.Max(maxIcon, (int)n.ToInt64()); return true; }, IntPtr.Zero);
    } finally { FreeLibrary(module); }
    if (!haveLang) lang = 1033;

    // New group directory: the .ico directory with each entry's file offset replaced by its new RT_ICON id.
    var group = new MemoryStream();
    var w = new BinaryWriter(group);
    w.Write((ushort)0); w.Write((ushort)1); w.Write((ushort)count);
    var images = new List<KeyValuePair<int, byte[]>>();
    for (int i = 0; i < count; i++) {
      int at = 6 + i * 16;
      int size = BitConverter.ToInt32(file, at + 8), offset = BitConverter.ToInt32(file, at + 12);
      if (size <= 0 || offset < 0 || offset + size > file.Length) throw new InvalidDataException("Image " + i + " is outside the .ico file.");
      int id = maxIcon + 1 + i;
      if (id > 0xFFFF) throw new InvalidDataException("Too many icon ids.");
      w.Write(file, at, 12);       // width, height, colors, reserved, planes, bit count, bytes in resource
      w.Write((ushort)id);
      var data = new byte[size]; Buffer.BlockCopy(file, offset, data, 0, size);
      images.Add(new KeyValuePair<int, byte[]>(id, data));
    }
    w.Flush();
    byte[] groupData = group.ToArray();

    IntPtr update = BeginUpdateResource(exe, false);
    if (update == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error(), "Cannot update " + exe);
    bool ok = false;
    IntPtr nameArg = groupString != null ? Marshal.StringToHGlobalUni(groupString) : groupName;
    try {
      foreach (var image in images)
        if (!UpdateResource(update, (IntPtr)RT_ICON, (IntPtr)image.Key, lang, image.Value, (uint)image.Value.Length)) throw new Win32Exception(Marshal.GetLastWin32Error(), "RT_ICON " + image.Key);
      if (!UpdateResource(update, (IntPtr)RT_GROUP_ICON, nameArg, lang, groupData, (uint)groupData.Length)) throw new Win32Exception(Marshal.GetLastWin32Error(), "RT_GROUP_ICON");
      ok = true;
    } finally {
      if (groupString != null) Marshal.FreeHGlobal(nameArg);
      if (!EndUpdateResource(update, !ok) && ok) throw new Win32Exception(Marshal.GetLastWin32Error(), "Cannot write " + exe);
    }
  }
}
