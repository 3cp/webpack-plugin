/// <reference path="./webpack.submodules.d.ts" />
import { IncludeDependency } from "./IncludeDependency";
import BasicEvaluatedExpression = require("webpack/lib/javascript/BasicEvaluatedExpression");
import * as estree from 'estree';
import * as webpack from 'webpack';

const TAP_NAME = "Aurelia:Dependencies";

export class AureliaDependenciesPlugin {
  private parserPlugin: ParserPlugin;

  constructor(...methods: string[]) {
    // Always include PLATFORM.moduleName as it's what used in libs.
    if (!methods.includes("PLATFORM.moduleName"))
      methods.push("PLATFORM.moduleName");
    this.parserPlugin = new ParserPlugin(methods);
  }

  apply(compiler: webpack.Compiler) {
    compiler.hooks.compilation.tap(TAP_NAME, (compilation, params) => {
      const normalModuleFactory = params.normalModuleFactory;

      compilation.dependencyFactories.set(AureliaDependency, normalModuleFactory);
      compilation.dependencyTemplates.set(AureliaDependency, new Template());

      normalModuleFactory.hooks.parser.for("javascript/auto").tap(TAP_NAME, parser => {
        this.parserPlugin.apply(parser);
      });
    });
  }
}

function isIdentifier(expr: estree.Expression | estree.Super, name: string): expr is estree.Identifier {
  return expr.type === 'Identifier' && expr.name === name;
}

class AureliaDependency extends IncludeDependency {
  constructor(request: string, 
              public range: [number, number], 
              options?: DependencyOptions) {
    super(request, options);
  }
}

class Template {
  apply(dep: AureliaDependency, source: webpack.sources.Source) {
    source.replace(dep.range[0], dep.range[1] - 1, "'" + dep.request.replace(/^async(?:\?[^!]*)?!/, "") + "'");
  };
}

class ParserPlugin {
  constructor(private methods: string[]) {
  }

  apply(parser: webpack.javascript.JavascriptParser) {

    function addDependency(module: string, range: [number, number], options?: DependencyOptions) {
      let dep = new AureliaDependency(module, range, options);
      parser.state.current.addDependency(dep);
      return true;
    }

    // The parser will only apply "call PLATFORM.moduleName" on free variables.
    // So we must first trick it into thinking PLATFORM.moduleName is an unbound identifier
    // in the various situations where it is not.

    const hooks = parser.hooks;

    // This covers native ES module, for example:
    //    import { PLATFORM } from "aurelia-pal";
    //    PLATFORM.moduleName("id");
    hooks.evaluateIdentifier.for('javascript/auto').tap(TAP_NAME, (expr: estree.MemberExpression) => {
      if (isIdentifier(expr.property, 'moduleName')
        && isIdentifier(expr.object, 'PLATFORM')
      ) {
        return new BasicEvaluatedExpression()
          .setIdentifier("PLATFORM.moduleName")
          .setRange(expr.range!);
      }
      return undefined;
    });

    // This covers commonjs modules, for example:
    //    const _aureliaPal = require("aurelia-pal");
    //    _aureliaPal.PLATFORM.moduleName("id");    
    // Or (note: no renaming supported):
    //    const PLATFORM = require("aurelia-pal").PLATFORM;
    //    PLATFORM.moduleName("id");
    hooks.evaluate.for('javascript/auto').tap(TAP_NAME, (expr: estree.MemberExpression) => {
      if (expr.type === 'MemberExpression'
        && isIdentifier(expr.property, "moduleName")
        && (
          expr.object.type === "MemberExpression" && isIdentifier(expr.object.property, "PLATFORM")
          || expr.object.type === "Identifier" && expr.object.name === "PLATFORM"
        )
      ) {
        return new BasicEvaluatedExpression()
          .setIdentifier("PLATFORM.moduleName")
          .setRange(expr.range!);
      }
      return undefined;
    });

    hooks.call.for('javascript/auto').tap(TAP_NAME, (expr: estree.CallExpression) => {
      if (expr.type !== 'CallExpression'
        || !this.methods.includes((expr.callee as estree.Identifier).name)
      ) {
        return;
      }
      if (expr.arguments.length === 0 || expr.arguments.length > 2) 
        return;

      let [arg1, arg2] = expr.arguments as estree.Expression[];
      let param1 = parser.evaluateExpression(arg1);
      if (!param1?.isString())
        return;
      if (expr.arguments.length === 1) {
        // Normal module dependency
        // PLATFORM.moduleName('some-module')
        return addDependency(param1.string!, expr.range!);
      }

      let options: DependencyOptions | undefined;
      let param2 = parser.evaluateExpression(arg2)!;
      if (param2?.isString()) {
        // Async module dependency
        // PLATFORM.moduleName('some-module', 'chunk name');
        options = { chunk: param2.string };
      }
      else if (arg2.type === "ObjectExpression") {
        // Module dependency with extended options
        // PLATFORM.moduleName('some-module', { option: value });
        options = {};
        // NOTE:
        // casting here is likely to be correct, as we can declare the following not supported:
        // PLATFORM.moduleName('some-module', { ...options })
        for (let prop of arg2.properties) {
          if (prop.type !== 'Property'
            || prop.method
            // theoretically, PLATFORM.moduleName('..', { ['chunk']: '' })
            // works, but ... not a lot of sense supporting it
            || prop.computed
            || prop.key.type !== "Identifier"
          )
            continue;

          let value = parser.evaluateExpression(prop.value as estree.Literal);
          switch (prop.key.name) {
            case "chunk":
              if (value?.isString()) 
                options.chunk = value.string;
              break;
            case "exports":
              if (value?.isArray() && value.items!.every(v => v.isString()))
                options.exports = value.items!.map(v => v.string!);
              break;
          }
        }
      }
      else {
        // Unknown PLATFORM.moduleName() signature
        return;
      }
      return addDependency(param1.string!, expr.range!, options);
    });
  }
}
