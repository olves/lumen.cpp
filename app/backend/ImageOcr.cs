using System;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using Windows.Storage;
using Windows.Graphics.Imaging;
using Windows.Globalization;
using Windows.Media.Ocr;

class ImageOcr {
 static string stage="initialize";
 [STAThread] static int Main(string[] args) {
  Console.OutputEncoding=new UTF8Encoding(false);
  try { Run(args);return 0; }
  catch(Exception e) { Console.WriteLine(new JavaScriptSerializer().Serialize(new {ok=false,error=stage+": "+e.Message}));return 1; }
 }
 static T Wait<T>(Windows.Foundation.IAsyncOperation<T> operation) {
  var info=(Windows.Foundation.IAsyncInfo)operation;
  while(info.Status==Windows.Foundation.AsyncStatus.Started)System.Threading.Thread.Sleep(15);
  if(info.Status==Windows.Foundation.AsyncStatus.Error)throw info.ErrorCode;
  if(info.Status==Windows.Foundation.AsyncStatus.Canceled)throw new OperationCanceledException();
  var result=operation.GetResults();info.Close();return result;
 }
 static void Wait(Windows.Foundation.IAsyncAction action) {
  var info=(Windows.Foundation.IAsyncInfo)action;
  while(info.Status==Windows.Foundation.AsyncStatus.Started)System.Threading.Thread.Sleep(15);
  if(info.Status==Windows.Foundation.AsyncStatus.Error)throw info.ErrorCode;
  if(info.Status==Windows.Foundation.AsyncStatus.Canceled)throw new OperationCanceledException();
  action.GetResults();info.Close();
 }
 static OcrEngine Engine(string language) {
  stage="language";
  var engine=OcrEngine.TryCreateFromLanguage(new Language(language));
  if(engine==null)engine=OcrEngine.TryCreateFromUserProfileLanguages();
  if(engine==null&&OcrEngine.AvailableRecognizerLanguages.Count>0)engine=OcrEngine.TryCreateFromLanguage(OcrEngine.AvailableRecognizerLanguages[0]);
  if(engine==null)throw new Exception("No local Windows OCR language is available.");
  return engine;
 }
 // v1.2: --pdf <file> <language> [maxPages]. Scanned PDFs have no text layer: Windows renders each page (Windows.Data.Pdf) and the
 // same OCR reads it. Prints {ok, pages:[text per page], total, language}; one line of progress per page on stderr.
 static void Pdf(string[] args) {
  var engine=Engine(args[2]);int max=args.Length>3?Math.Max(1,Math.Min(200,int.Parse(args[3]))):40;
  stage="open";var file=Wait(StorageFile.GetFileFromPathAsync(System.IO.Path.GetFullPath(args[1])));
  var pdf=Wait(Windows.Data.Pdf.PdfDocument.LoadFromFileAsync(file));
  if(pdf.IsPasswordProtected)throw new Exception("The PDF is protected by a password.");
  var pages=new System.Collections.Generic.List<string>();uint count=Math.Min(pdf.PageCount,(uint)max);
  for(uint i=0;i<count;i++){
   stage="page "+(i+1);
   using(var page=pdf.GetPage(i))using(var stream=new Windows.Storage.Streams.InMemoryRandomAccessStream()){
    // About 200 dpi for an A4 page: 1700 px wide, within the OCR limit.
    var width=(uint)Math.Min(OcrEngine.MaxImageDimension,1700);var height=(uint)Math.Min(OcrEngine.MaxImageDimension,Math.Round(width*page.Size.Height/Math.Max(1,page.Size.Width)));
    Wait(page.RenderToStreamAsync(stream,new Windows.Data.Pdf.PdfPageRenderOptions{DestinationWidth=width,DestinationHeight=height}));stream.Seek(0);
    var decoder=Wait(BitmapDecoder.CreateAsync(stream));
    using(var bitmap=Wait(decoder.GetSoftwareBitmapAsync(BitmapPixelFormat.Bgra8,BitmapAlphaMode.Premultiplied))){var result=Wait(engine.RecognizeAsync(bitmap));pages.Add(string.Join("\n",result.Lines.Select(line=>line.Text)));}
   }
   Console.Error.WriteLine("page "+(i+1)+"/"+count);
  }
  Console.WriteLine(new JavaScriptSerializer{MaxJsonLength=int.MaxValue}.Serialize(new {ok=true,pages=pages,total=pdf.PageCount,language=engine.RecognizerLanguage.LanguageTag}));
 }
 static void Run(string[] args) {
  if(args.Length>=3&&args[0]=="--pdf"){Pdf(args);return;}
  if(args.Length!=2)throw new ArgumentException("Expected an image and OCR language.");
  var engine=Engine(args[1]);
  stage="read";
  var bytes=System.IO.File.ReadAllBytes(System.IO.Path.GetFullPath(args[0]));
  using(var stream=new Windows.Storage.Streams.InMemoryRandomAccessStream()) {
   using(var writer=new Windows.Storage.Streams.DataWriter(stream)){writer.WriteBytes(bytes);Wait(writer.StoreAsync());writer.DetachStream();}stream.Seek(0);
   stage="decode";var decoder=Wait(BitmapDecoder.CreateAsync(stream));
   using(var bitmap=Wait(decoder.GetSoftwareBitmapAsync(BitmapPixelFormat.Bgra8,BitmapAlphaMode.Premultiplied))) {
    if(bitmap.PixelWidth>OcrEngine.MaxImageDimension||bitmap.PixelHeight>OcrEngine.MaxImageDimension)throw new Exception("Image exceeds the OCR dimension limit.");
    stage="recognize";var result=Wait(engine.RecognizeAsync(bitmap));
    Console.WriteLine(new JavaScriptSerializer().Serialize(new {ok=true,text=string.Join("\n",result.Lines.Select(line=>line.Text)),language=engine.RecognizerLanguage.LanguageTag}));
   }
  }
 }
}
