// platform.image: decode, scale and PNG-encode pictures with the `image` crate (Electron used nativeImage and, for WebP, Chromium's
// canvas). Inputs and outputs are files chosen by the core under <data>/temp/rpc (platform.cjs RPC conventions).
//
// Photo IDs: the core names a photo by the SHA-256 of its normalized PNG. This encoder's PNG bytes are not byte-identical to
// Electron's nativeImage output, so the same photo added under Tauri gets a different ID than under Electron (ruling T3-a).
// Existing photos are unaffected (they are stored files); only the dedup between a Tauri-added and an Electron-added copy of
// the same picture is lost. Sizes and resize rules match Electron: normalize scales down only when the long side is larger than
// maxSide (quality 'best' or 'good'), thumbnails never scale up and use 'good', fit 'width' sets only the width.
use image::imageops::FilterType;
use image::{DynamicImage, ImageFormat, ImageReader, Limits};
use serde_json::{json, Value};
use std::io::Cursor;
use std::path::Path;

/// Decoding limit: the core accepts sources up to 12 MB and 50 million pixels; this only stops decompression bombs.
const MAX_ALLOC: u64 = 1024 * 1024 * 1024;
const WEBP_MAX_SIDE: f64 = 1600.0;
const WEBP_MAX_PIXELS: u64 = 50_000_000;

fn filter(quality: &str) -> FilterType {
    // Skia's RESIZE_BEST is a Lanczos3 filter; 'good' is a cheaper smooth filter.
    if quality == "best" { FilterType::Lanczos3 } else { FilterType::Triangle }
}

/// JavaScript's Math.max(1, Math.round(x)) for the positive sizes used here.
fn side(x: f64) -> u32 {
    (x.round() as u32).max(1)
}

fn decode(bytes: &[u8], format: Option<ImageFormat>) -> Option<DynamicImage> {
    let mut reader = ImageReader::new(Cursor::new(bytes));
    match format {
        Some(f) => reader.set_format(f),
        None => reader = reader.with_guessed_format().ok()?,
    }
    let mut limits = Limits::default();
    limits.max_alloc = Some(MAX_ALLOC);
    reader.limits(limits);
    reader.decode().ok()
}

/// PNG as nativeImage writes it: 8-bit RGBA.
fn write_png(image: &DynamicImage, out: &Path) -> Result<(), String> {
    let mut bytes = Vec::new();
    DynamicImage::ImageRgba8(image.to_rgba8()).write_to(&mut Cursor::new(&mut bytes), ImageFormat::Png).map_err(|e| format!("PNG encoding failed: {e}"))?;
    std::fs::write(out, bytes).map_err(|e| format!("The image could not be written: {e}"))
}

fn read(input: &Path) -> Result<Vec<u8>, String> {
    std::fs::read(input).map_err(|e| format!("The image could not be read: {e}"))
}

/// image.normalize [inPath, outPath, maxSide|null, quality] -> null | {width, height, original:{width, height}}
pub fn normalize(input: &Path, out: &Path, max_side: Option<f64>, quality: &str) -> Result<Value, String> {
    let Some(mut image) = decode(&read(input)?, None) else { return Ok(Value::Null) };
    let (w, h) = (image.width(), image.height());
    let long = w.max(h) as f64;
    if let Some(max) = max_side.filter(|m| long > *m) {
        let scale = max / long;
        image = image.resize_exact(side(w as f64 * scale), side(h as f64 * scale), filter(quality));
    }
    write_png(&image, out)?;
    Ok(json!({"width": image.width(), "height": image.height(), "original": {"width": w, "height": h}}))
}

/// image.thumbnail [inPath, outPath, maxSide, fit]: never scales up; 'width' fits only the width.
pub fn thumbnail(input: &Path, out: &Path, max_side: f64, fit: &str) -> Result<Value, String> {
    let image = decode(&read(input)?, None).ok_or("The image could not be decoded.")?;
    let (w, h) = (image.width() as f64, image.height() as f64);
    let (tw, th) = if fit == "width" {
        let width = max_side.min(w);
        (side(width), side(h * width / w))
    } else {
        let scale = (max_side / w.max(h)).min(1.0);
        (side(w * scale), side(h * scale))
    };
    let resized = if (tw, th) == (image.width(), image.height()) { image } else { image.resize_exact(tw, th, filter("good")) };
    write_png(&resized, out)?;
    Ok(Value::Null)
}

/// image.decodeWebp [inPath, outPath]: WebP -> PNG, at most 1600 px on the long side and 50 million pixels (as Electron's canvas path).
pub fn decode_webp(input: &Path, out: &Path) -> Result<Value, String> {
    let bytes = read(input)?;
    let image = decode(&bytes, Some(ImageFormat::WebP)).ok_or("The WebP image could not be decoded.")?;
    if image.width() as u64 * image.height() as u64 > WEBP_MAX_PIXELS {
        return Err("Use a photo with at most 50 million pixels.".into());
    }
    let (w, h) = (image.width() as f64, image.height() as f64);
    let scale = (WEBP_MAX_SIDE / w.max(h)).min(1.0);
    let (tw, th) = (side(w * scale), side(h * scale));
    let image = if (tw, th) == (image.width(), image.height()) { image } else { image.resize_exact(tw, th, FilterType::Triangle) };
    write_png(&image, out)?;
    Ok(Value::Null)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::platform::secrets::tests::temp_dir;
    use image::RgbaImage;

    fn fixture(name: &str) -> std::path::PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("tests").join("fixtures").join(name)
    }

    fn png_size(file: &Path) -> (u32, u32) {
        let bytes = std::fs::read(file).unwrap();
        assert_eq!(&bytes[..8], b"\x89PNG\r\n\x1a\n", "PNG output");
        let i = image::load_from_memory_with_format(&bytes, ImageFormat::Png).unwrap();
        (i.width(), i.height())
    }

    fn write_test_png(dir: &Path, name: &str, w: u32, h: u32) -> std::path::PathBuf {
        let file = dir.join(name);
        RgbaImage::from_fn(w, h, |x, y| image::Rgba([(x % 256) as u8, (y % 256) as u8, 128, 255])).save_with_format(&file, ImageFormat::Png).unwrap();
        file
    }

    #[test]
    fn webp_to_png() {
        let dir = temp_dir("webp");
        let input = fixture("sample.webp");
        let original = image::load_from_memory_with_format(&std::fs::read(&input).unwrap(), ImageFormat::WebP).unwrap();
        decode_webp(&input, &dir.join("out.png")).unwrap();
        assert_eq!(png_size(&dir.join("out.png")), (original.width(), original.height()));
        assert_eq!((original.width(), original.height()), (640, 427));
        assert!(decode_webp(&write_test_png(&dir, "not-webp.png", 4, 4), &dir.join("x.png")).is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn thumbnail_max_side_512() {
        let dir = temp_dir("thumb");
        let wide = write_test_png(&dir, "wide.png", 1600, 900);
        thumbnail(&wide, &dir.join("t1.png"), 512.0, "longest").unwrap();
        assert_eq!(png_size(&dir.join("t1.png")), (512, 288));
        let tall = write_test_png(&dir, "tall.png", 900, 1600);
        thumbnail(&tall, &dir.join("t2.png"), 512.0, "longest").unwrap();
        assert_eq!(png_size(&dir.join("t2.png")), (288, 512));
        // Never scales up.
        let small = write_test_png(&dir, "small.png", 300, 200);
        thumbnail(&small, &dir.join("t3.png"), 512.0, "longest").unwrap();
        assert_eq!(png_size(&dir.join("t3.png")), (300, 200));
        // fit 'width': only the width is limited (imagegen thumbnails).
        thumbnail(&tall, &dir.join("t4.png"), 512.0, "width").unwrap();
        assert_eq!(png_size(&dir.join("t4.png")), (512, 910));
        thumbnail(&small, &dir.join("t5.png"), 512.0, "width").unwrap();
        assert_eq!(png_size(&dir.join("t5.png")), (300, 200));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn normalize_scales_down_only_and_reports_sizes() {
        let dir = temp_dir("norm");
        let big = write_test_png(&dir, "big.png", 3000, 2001);
        let info = normalize(&big, &dir.join("n1.png"), Some(1600.0), "best").unwrap();
        assert_eq!(info, json!({"width": 1600, "height": 1067, "original": {"width": 3000, "height": 2001}}));
        assert_eq!(png_size(&dir.join("n1.png")), (1600, 1067));
        let small = write_test_png(&dir, "small.png", 640, 480);
        assert_eq!(normalize(&small, &dir.join("n2.png"), Some(1600.0), "best").unwrap()["width"], 640);
        assert_eq!(normalize(&big, &dir.join("n3.png"), None, "good").unwrap()["width"], 3000);
        let junk = dir.join("junk.bin");
        std::fs::write(&junk, b"not an image").unwrap();
        assert_eq!(normalize(&junk, &dir.join("n4.png"), Some(1600.0), "best").unwrap(), Value::Null);
        // JPEG input becomes PNG.
        let jpg = dir.join("p.jpg");
        DynamicImage::ImageRgb8(image::RgbImage::from_pixel(2000, 1000, image::Rgb([200, 100, 50]))).save_with_format(&jpg, ImageFormat::Jpeg).unwrap();
        normalize(&jpg, &dir.join("n5.png"), Some(1600.0), "best").unwrap();
        assert_eq!(png_size(&dir.join("n5.png")), (1600, 800));
        std::fs::remove_dir_all(dir).unwrap();
    }
}
