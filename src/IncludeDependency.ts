import { dependencyImports } from "./PreserveExportsPlugin";
import { preserveModuleName } from "./PreserveModuleNamePlugin";
import * as webpack from 'webpack';

export class IncludeDependency extends webpack.dependencies.ModuleDependency {
  private options?: DependencyOptions;

  constructor(request: string, options?: DependencyOptions) {
    let chunk = options && options.chunk;
    super(chunk ? `async?lazy&name=${chunk}!${request}` : request);
    this.options = options;
  }

  // @ts-expect-error
  get type() {
    return "aurelia module";
  }

  // getReference() {
  //   let importedNames = this.options && this.options.exports;
  //   // this['getReferencedExports']
  //   return importedNames ? 
  //     { module: this.module, importedNames } :
  //     super.getReference();
  // }

  getReferencedExports() {
    return this.options?.exports
      ? [this.options.exports]
      : webpack.Dependency.NO_EXPORTS_REFERENCED;
  }

  get [preserveModuleName]() {
    return true;
  }

  get [dependencyImports]() {
    return this.options && this.options.exports;
  }
};

export type NullDependencyTemplate = typeof webpack.dependencies.NullDependency.Template;
export const Template: NullDependencyTemplate = webpack.dependencies.NullDependency.Template;
