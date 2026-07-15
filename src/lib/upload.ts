import { mkdir } from "node:fs/promises";
import { extname, join } from "node:path";

export const saveUploadedImage = async (
  directory: string,
  publicPath: string,
  filenamePrefix: string,
  image?: File,
) => {
  if (!image) return undefined;

  const uploadDir = join(process.cwd(), "public", "uploads", directory);

  await mkdir(uploadDir, { recursive: true });

  const extension = extname(image.name) || `.${image.type.split("/")[1]}`;
  const filename = `${filenamePrefix}-${crypto.randomUUID()}${extension}`;
  const filepath = join(uploadDir, filename);

  await Bun.write(filepath, image);

  return `/uploads/${publicPath}/${filename}`;
};
