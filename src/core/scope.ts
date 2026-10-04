import { children, type Node } from './ast';

export type Binding = { kind: 'local' } | { kind: 'alias'; method: string; id: Node };

const LOCAL: Binding = { kind: 'local' };

export class Scope {
  readonly bindings = new Map<string, Binding>();

  constructor(readonly parent: Scope | null) {}

  lookup(name: string): Binding | undefined {
    for (let scope: Scope | null = this; scope; scope = scope.parent) {
      const binding = scope.bindings.get(name);
      if (binding) return binding;
    }
    return undefined;
  }

  declare(name: string, binding: Binding = LOCAL): void {
    this.bindings.set(name, binding);
  }

  declarePattern(pattern: Node | null): void {
    for (const name of patternNames(pattern)) this.declare(name);
  }
}

/** Names bound by a binding pattern (identifier, destructuring, defaults, rest). */
export function patternNames(pattern: Node | null): string[] {
  if (!pattern) return [];
  switch (pattern.type) {
    case 'Identifier':
      return [pattern.name];
    case 'ObjectPattern':
      return pattern.properties.flatMap((prop: Node) =>
        patternNames(prop.type === 'RestElement' ? prop.argument : prop.value),
      );
    case 'ArrayPattern':
      return pattern.elements.flatMap((el: Node | null) => patternNames(el));
    case 'AssignmentPattern':
      return patternNames(pattern.left);
    case 'RestElement':
      return patternNames(pattern.argument);
    case 'TSParameterProperty':
      return patternNames(pattern.parameter);
    default:
      return [];
  }
}

const FUNCTION_TYPES = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
]);

/** Declare `var` bindings found anywhere in `node`, without entering nested functions. */
export function hoistVars(node: Node, scope: Scope): void {
  for (const child of children(node)) {
    if (FUNCTION_TYPES.has(child.type)) continue;
    if (child.type === 'VariableDeclaration' && child.kind === 'var') {
      for (const decl of child.declarations) scope.declarePattern(decl.id);
    }
    hoistVars(child, scope);
  }
}

/** Declare the lexical bindings (`let`, `const`, `class`, `function`, imports) of a statement list. */
export function declareLexical(statements: Node[], scope: Scope): void {
  for (const raw of statements) {
    const stmt =
      (raw.type === 'ExportNamedDeclaration' || raw.type === 'ExportDefaultDeclaration') &&
      raw.declaration
        ? raw.declaration
        : raw;
    switch (stmt.type) {
      case 'VariableDeclaration':
        for (const decl of stmt.declarations) scope.declarePattern(decl.id);
        break;
      case 'FunctionDeclaration':
      case 'ClassDeclaration':
      case 'TSEnumDeclaration':
      case 'TSModuleDeclaration':
        if (stmt.id?.type === 'Identifier') scope.declare(stmt.id.name);
        break;
      case 'ImportDeclaration':
        for (const spec of stmt.specifiers) scope.declare(spec.local.name);
        break;
      case 'TSImportEqualsDeclaration':
        scope.declare(stmt.id.name);
        break;
    }
  }
}
