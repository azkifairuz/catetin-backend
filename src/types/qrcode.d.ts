declare module "qrcode" {
  type ToStringOptions = {
    type?: "svg" | "utf8" | "terminal";
    margin?: number;
    width?: number;
    errorCorrectionLevel?: "L" | "M" | "Q" | "H";
  };

  const qrcode: {
    toString(text: string, options?: ToStringOptions): Promise<string>;
  };

  export default qrcode;
}
