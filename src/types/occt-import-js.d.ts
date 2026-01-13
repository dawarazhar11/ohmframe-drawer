declare module 'occt-import-js' {
  interface OcctImportJsOptions {
    locateFile?: (name: string) => string;
    instantiateWasm?: (
      imports: WebAssembly.Imports,
      receiveInstance: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void
    ) => Promise<WebAssembly.Exports>;
  }

  interface OcctMeshAttributes {
    position: {
      array: number[];
    };
    normal?: {
      array: number[];
    };
  }

  interface OcctBrepFace {
    first: number;
    last: number;
    color?: [number, number, number];
  }

  interface OcctMesh {
    attributes: OcctMeshAttributes;
    index?: {
      array: number[];
    };
    brep_faces?: OcctBrepFace[];
  }

  interface OcctResult {
    success: boolean;
    error?: string;
    meshes?: OcctMesh[];
  }

  interface OcctInstance {
    ReadStepFile: (fileBuffer: Uint8Array, settings: null) => OcctResult;
  }

  function occtimportjs(options?: OcctImportJsOptions): Promise<OcctInstance>;

  export default occtimportjs;
}
