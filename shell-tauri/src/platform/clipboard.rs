// platform.clipboard with arboard (text and RGBA images; arboard puts a PNG and a DIB on the Windows clipboard).
//   writeText(text)    writePng(pngPath)
//   read() -> [{type:'text', text} | {type:'image', mime:'image/png', path}]
// read() matches Electron's shell: an image wins and ends the list (the shell stops at the first image), else the text. The image
// is written as PNG to <data>/temp/clipboard/<random>, where the core reads and deletes it (it accepts only paths there).
use super::random_hex;
use arboard::{Clipboard, ImageData};
use image::{DynamicImage, ImageFormat, RgbaImage};
use serde_json::{json, Value};
use std::borrow::Cow;
use std::io::Cursor;
use std::path::Path;

fn open() -> Result<Clipboard, String> {
    Clipboard::new().map_err(|e| format!("The clipboard is unavailable: {e}"))
}

pub fn write_text(text: &str) -> Result<Value, String> {
    open()?.set_text(text).map_err(|e| format!("The clipboard could not be written: {e}"))?;
    Ok(Value::Null)
}

pub fn write_png(file: &Path) -> Result<Value, String> {
    let bytes = std::fs::read(file).map_err(|e| format!("The image could not be read: {e}"))?;
    let rgba = image::load_from_memory_with_format(&bytes, ImageFormat::Png).map_err(|e| format!("The image could not be decoded: {e}"))?.to_rgba8();
    let (width, height) = (rgba.width() as usize, rgba.height() as usize);
    open()?
        .set_image(ImageData { width, height, bytes: Cow::Owned(rgba.into_raw()) })
        .map_err(|e| format!("The clipboard could not be written: {e}"))?;
    Ok(Value::Null)
}

/// RGBA from the clipboard -> PNG bytes.
fn encode_png(width: usize, height: usize, bytes: Vec<u8>) -> Option<Vec<u8>> {
    let image = RgbaImage::from_raw(width as u32, height as u32, bytes)?;
    let mut out = Vec::new();
    DynamicImage::ImageRgba8(image).write_to(&mut Cursor::new(&mut out), ImageFormat::Png).ok()?;
    Some(out)
}

pub fn read(data: &Path) -> Result<Value, String> {
    let mut clipboard = open()?;
    if let Ok(image) = clipboard.get_image() {
        if let Some(png) = encode_png(image.width, image.height, image.bytes.into_owned()) {
            let dir = data.join("temp").join("clipboard");
            std::fs::create_dir_all(&dir).map_err(|e| format!("The clipboard image could not be saved: {e}"))?;
            let file = dir.join(random_hex(12));
            std::fs::write(&file, png).map_err(|e| format!("The clipboard image could not be saved: {e}"))?;
            return Ok(json!([{"type": "image", "mime": "image/png", "path": file.to_string_lossy()}]));
        }
    }
    match clipboard.get_text() {
        Ok(text) => Ok(json!([{"type": "text", "text": text}])),
        Err(_) => Ok(json!([])),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clipboard_rgba_becomes_png() {
        let png = encode_png(3, 2, vec![255; 3 * 2 * 4]).unwrap();
        let back = image::load_from_memory_with_format(&png, ImageFormat::Png).unwrap();
        assert_eq!((back.width(), back.height()), (3, 2));
        assert!(encode_png(3, 2, vec![0; 5]).is_none(), "a short buffer is not an image");
    }
}
