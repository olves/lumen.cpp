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
 static void Run(string[] args) {
  if(args.Length!=2)throw new ArgumentException("Expected an image and OCR language.");
  stage="language";
  var engine=OcrEngine.TryCreateFromLanguage(new Language(args[1]));
  if(engine==null)engine=OcrEngine.TryCreateFromUserProfileLanguages();
  if(engine==null&&OcrEngine.AvailableRecognizerLanguages.Count>0)engine=OcrEngine.TryCreateFromLanguage(OcrEngine.AvailableRecognizerLanguages[0]);
  if(engine==null)throw new Exception("No local Windows OCR language is available.");
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
