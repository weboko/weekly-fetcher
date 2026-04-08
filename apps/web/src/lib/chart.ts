export async function downloadSvgAsPng(svgElement: SVGSVGElement, filename: string) {
  const serializer = new XMLSerializer();
  const svgString = serializer.serializeToString(svgElement);
  const blob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const image = new Image();

  const pngBlob = await new Promise<Blob>((resolve, reject) => {
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = svgElement.viewBox.baseVal.width || svgElement.clientWidth || 900;
      canvas.height = svgElement.viewBox.baseVal.height || svgElement.clientHeight || 520;
      const context = canvas.getContext("2d");
      if (!context) {
        reject(new Error("Canvas context unavailable"));
        return;
      }
      context.fillStyle = "#f6f4ec";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0);
      canvas.toBlob((blobValue) => {
        if (!blobValue) {
          reject(new Error("PNG export failed"));
          return;
        }
        resolve(blobValue);
      });
    };
    image.onerror = () => reject(new Error("SVG load failed"));
    image.src = url;
  });

  URL.revokeObjectURL(url);
  const downloadUrl = URL.createObjectURL(pngBlob);
  const anchor = document.createElement("a");
  anchor.href = downloadUrl;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(downloadUrl);
}

