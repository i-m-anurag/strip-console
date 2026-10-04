import MagicString, { type SourceMap } from 'magic-string';
import { parseSync } from 'oxc-parser';
import { isNode, type Node, propertyName, unwrap } from './ast';
import { type ResolvedOptions, resolveOptions, type StripConsoleOptions } from './options';
import { isPure } from './purity';
import { declareLexical, hoistVars, Scope } from './scope';

export interface RemovedCall {
  /** What was removed: a console method name, a logger path, or `debugger`. */
  method: string;
  /** 1-based line of the removed code in the input. */
  line: number;
  /** 0-based column of the removed code in the input. */
  column: number;
}

export interface TransformResult {
  code: string;
  /** Source map from the output back to the input, or `null` when nothing changed or maps are off. */
  map: SourceMap | null;
  removed: RemovedCall[];
}

interface Comment {
  type: string;
  value: string;
  start: number;
  end: number;
}

/** Objects that expose the global `console` as a property. */
const GLOBAL_OBJECTS = new Set(['window', 'globalThis', 'self', 'global']);

/** Statement lists where a statement can be deleted outright instead of left as `;`. */
const STATEMENT_LISTS = new Set([
  'Program',
  'BlockStatement',
  'StaticBlock',
  'SwitchCase',
  'TSModuleBlock',
]);

/** Subtrees with no runtime meaning, never visited. */
const TYPE_ONLY = new Set([
  'TSTypeAnnotation',
  'TSTypeParameterDeclaration',
  'TSTypeParameterInstantiation',
  'TSInterfaceDeclaration',
  'TSTypeAliasDeclaration',
  'TSDeclareFunction',
]);

/** Expression types that cannot start an expression statement without parentheses. */
const UNSAFE_STATEMENT_START = new Set([
  'ObjectExpression',
  'FunctionExpression',
  'ClassExpression',
  'ObjectPattern',
]);

/**
 * Remove console calls (and optionally `debugger` statements) from JavaScript or TypeScript code.
 *
 * Arguments with side effects are kept, so behaviour only changes by the missing log output.
 * A call preceded by the keep comment (default `/* keep *\/`) is left untouched.
 */
export function transform(code: string, options: StripConsoleOptions = {}): TransformResult {
  const opts = resolveOptions(options);
  if (!mayContainTargets(code, opts)) return { code, map: null, removed: [] };

  const parsed = parseSync(opts.filename, code);
  if (parsed.errors.length > 0) {
    const first = parsed.errors[0];
    throw new SyntaxError(
      `strip-console: failed to parse ${opts.filename}: ${first?.message ?? 'unknown error'}`,
    );
  }
  const program = parsed.program as unknown as Node;
  const comments = parsed.comments as Comment[];

  // An alias such as `const { log } = console` can only be deleted when every use of it is a
  // call we remove. Each pass records aliases that escape; repeat until that set is stable.
  const escaped = new Set<Node>();
  let pass: Pass;
  let before: number;
  do {
    before = escaped.size;
    pass = new Pass(code, comments, opts, escaped);
    pass.run(program);
  } while (escaped.size !== before);

  if (!pass.s.hasChanged()) return { code, map: null, removed: [] };
  return {
    code: pass.s.toString(),
    map: opts.sourcemap
      ? pass.s.generateMap({ source: opts.filename, hires: 'boundary', includeContent: true })
      : null,
    removed: pass.removed.sort((a, b) => a.line - b.line || a.column - b.column),
  };
}

function mayContainTargets(code: string, opts: ResolvedOptions): boolean {
  if (code.includes('console')) return true;
  if (opts.debugger && code.includes('debugger')) return true;
  return opts.loggers.some((path) => code.includes(path.at(-1) ?? ''));
}

class Pass {
  readonly s: MagicString;
  readonly removed: RemovedCall[] = [];
  private lineStarts: number[] | null = null;

  constructor(
    private readonly code: string,
    private readonly comments: Comment[],
    private readonly opts: ResolvedOptions,
    private readonly escaped: Set<Node>,
  ) {
    this.s = new MagicString(code);
  }

  run(program: Node): void {
    const scope = new Scope(null);
    hoistVars(program, scope);
    this.enterStatements(program.body, scope);
    this.visitList(program.body, program, scope);
  }

  // ---------------------------------------------------------------- traversal

  private visitList(nodes: Node[], parent: Node, scope: Scope): void {
    for (const node of nodes) this.visit(node, parent, '', scope);
  }

  private visitChildren(node: Node, scope: Scope): void {
    for (const key in node) {
      if (key === 'type' || key === 'start' || key === 'end') continue;
      const value = node[key];
      if (Array.isArray(value)) {
        for (const item of value) if (isNode(item)) this.visit(item, node, key, scope);
      } else if (isNode(value)) {
        this.visit(value, node, key, scope);
      }
    }
  }

  private visit(node: Node, parent: Node, key: string, scope: Scope): void {
    if (TYPE_ONLY.has(node.type)) return;

    switch (node.type) {
      case 'ExpressionStatement': {
        const target = this.matchCall(node.expression, scope);
        if (target) {
          this.removeCall(target, node, parent, key, scope);
          return;
        }
        break;
      }
      case 'CallExpression':
      case 'ChainExpression': {
        const target = this.matchCall(node, scope);
        if (target) {
          this.removeCall(target, null, parent, key, scope);
          return;
        }
        break;
      }
      case 'DebuggerStatement':
        if (this.opts.debugger) {
          this.record('debugger', node.start);
          this.removeStatement(node, parent);
        }
        return;
      case 'VariableDeclaration':
        this.visitDeclaration(node, parent, scope);
        return;
      case 'Identifier':
        if (isReference(parent, key)) this.noteReference(node, scope);
        return;
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
        this.visitFunction(node, scope);
        return;
      case 'BlockStatement':
      case 'StaticBlock':
      case 'TSModuleBlock': {
        const inner = new Scope(scope);
        this.enterStatements(node.body, inner);
        this.visitList(node.body, node, inner);
        return;
      }
      case 'SwitchStatement': {
        this.visit(node.discriminant, node, 'discriminant', scope);
        const inner = new Scope(scope);
        this.enterStatements(
          node.cases.flatMap((c: Node) => c.consequent),
          inner,
        );
        for (const c of node.cases) {
          if (c.test) this.visit(c.test, c, 'test', inner);
          this.visitList(c.consequent, c, inner);
        }
        return;
      }
      case 'ForStatement':
      case 'ForInStatement':
      case 'ForOfStatement': {
        const inner = new Scope(scope);
        const head = node.type === 'ForStatement' ? node.init : node.left;
        if (head?.type === 'VariableDeclaration' && head.kind !== 'var') {
          for (const decl of head.declarations) inner.declarePattern(decl.id);
        }
        this.visitChildren(node, inner);
        return;
      }
      case 'CatchClause': {
        const inner = new Scope(scope);
        inner.declarePattern(node.param);
        if (node.param) this.visitPattern(node.param, inner);
        this.visit(node.body, node, 'body', inner);
        return;
      }
      case 'ClassExpression':
      case 'ClassDeclaration': {
        const inner = new Scope(scope);
        if (node.id) inner.declare(node.id.name);
        if (node.superClass) this.visit(node.superClass, node, 'superClass', inner);
        for (const d of node.decorators ?? []) this.visit(d, node, 'decorators', inner);
        this.visit(node.body, node, 'body', inner);
        return;
      }
    }

    this.visitChildren(node, scope);
  }

  private visitFunction(node: Node, scope: Scope): void {
    const inner = new Scope(scope);
    if (node.type === 'FunctionExpression' && node.id) inner.declare(node.id.name);
    for (const param of node.params) inner.declarePattern(param);
    for (const param of node.params) this.visitPattern(param, inner);
    const body = node.body;
    if (!body) return;
    if (body.type === 'BlockStatement') {
      hoistVars(body, inner);
      this.enterStatements(body.body, inner);
      this.visitList(body.body, body, inner);
    } else {
      this.visit(body, node, 'body', inner);
    }
  }

  /** Visit only the expressions inside a binding pattern (defaults, computed keys), not the names. */
  private visitPattern(pattern: Node | null, scope: Scope): void {
    if (!pattern) return;
    switch (pattern.type) {
      case 'AssignmentPattern':
        this.visitPattern(pattern.left, scope);
        this.visit(pattern.right, pattern, 'right', scope);
        return;
      case 'ObjectPattern':
        for (const prop of pattern.properties) {
          if (prop.type === 'RestElement') {
            this.visitPattern(prop.argument, scope);
          } else {
            if (prop.computed) this.visit(prop.key, prop, 'key', scope);
            this.visitPattern(prop.value, scope);
          }
        }
        return;
      case 'ArrayPattern':
        for (const el of pattern.elements) this.visitPattern(el, scope);
        return;
      case 'RestElement':
        this.visitPattern(pattern.argument, scope);
        return;
      case 'TSParameterProperty':
        this.visitPattern(pattern.parameter, scope);
        return;
      case 'Identifier':
        return;
      default:
        // Assignment targets such as `obj.prop` in `[obj.prop] = list`.
        this.visit(pattern, pattern, '', scope);
    }
  }

  // ---------------------------------------------------------------- scopes and aliases

  /** Declare a statement list's lexical bindings and mark console aliases among them. */
  private enterStatements(statements: Node[], scope: Scope): void {
    declareLexical(statements, scope);
    for (const stmt of statements) {
      // `var` aliases are left alone: they hoist past the block that declares them.
      if (stmt.type !== 'VariableDeclaration' || stmt.kind === 'var') continue;
      for (const decl of stmt.declarations) {
        for (const alias of this.aliasesIn(decl, scope)) {
          scope.declare(alias.id.name, { kind: 'alias', method: alias.method, id: alias.id });
        }
      }
    }
  }

  /** Bindings in `decl` that hold a removable console method, e.g. `log` in `const { log } = console`. */
  private aliasesIn(decl: Node, scope: Scope): { id: Node; method: string; prop: Node | null }[] {
    if (!decl.init) return [];
    const init = unwrap(decl.init);
    const out: { id: Node; method: string; prop: Node | null }[] = [];

    if (decl.id.type === 'ObjectPattern' && this.isConsole(init, scope)) {
      for (const prop of decl.id.properties) {
        if (prop.type !== 'Property' || prop.value.type !== 'Identifier') continue;
        const method = prop.computed
          ? prop.key.type === 'Literal' && typeof prop.key.value === 'string'
            ? prop.key.value
            : null
          : prop.key.type === 'Identifier'
            ? prop.key.name
            : prop.key.type === 'Literal'
              ? String(prop.key.value)
              : null;
        if (method && this.opts.methods.has(method)) out.push({ id: prop.value, method, prop });
      }
    } else if (
      decl.id.type === 'Identifier' &&
      init.type === 'MemberExpression' &&
      this.isConsole(init.object, scope)
    ) {
      const method = propertyName(init);
      if (method && this.opts.methods.has(method)) out.push({ id: decl.id, method, prop: null });
    }

    return out.filter((alias) => !this.escaped.has(alias.id));
  }

  /** A use of an alias anywhere except as the callee of a removed call means it must stay. */
  private noteReference(id: Node, scope: Scope): void {
    const binding = scope.lookup(id.name);
    if (binding?.kind === 'alias') this.escaped.add(binding.id);
  }

  private visitDeclaration(node: Node, parent: Node, scope: Scope): void {
    const isStatement = STATEMENT_LISTS.has(parent.type) || !parent.type.startsWith('For');
    const exported = parent.type.startsWith('Export');
    const removable = isStatement && !exported && node.kind !== 'var';

    const fullyRemoved = new Set<number>();
    node.declarations.forEach((decl: Node, index: number) => {
      const aliases = removable ? this.aliasesIn(decl, scope) : [];
      if (aliases.length === 0) {
        this.visitPattern(decl.id, scope);
        if (decl.init) this.visit(decl.init, decl, 'init', scope);
        return;
      }
      if (decl.id.type === 'Identifier') {
        fullyRemoved.add(index);
        return;
      }
      const props: Node[] = decl.id.properties;
      const removedProps = new Set(aliases.map((a) => props.indexOf(a.prop as Node)));
      if (removedProps.size === props.length) {
        fullyRemoved.add(index);
        return;
      }
      this.removeListItems(props, removedProps);
      props.forEach((prop, i) => {
        if (!removedProps.has(i))
          this.visitPattern(prop.type === 'RestElement' ? prop : prop.value, scope);
      });
    });

    if (fullyRemoved.size === 0) return;
    if (fullyRemoved.size === node.declarations.length) {
      this.removeStatement(node, parent);
      return;
    }
    this.removeListItems(node.declarations, fullyRemoved);
  }

  // ---------------------------------------------------------------- matching

  private isConsole(input: Node, scope: Scope): boolean {
    const node = unwrap(input);
    if (node.type === 'Identifier') return node.name === 'console' && !scope.lookup('console');
    if (node.type === 'MemberExpression' && propertyName(node) === 'console') {
      const obj = unwrap(node.object);
      return obj.type === 'Identifier' && GLOBAL_OBJECTS.has(obj.name) && !scope.lookup(obj.name);
    }
    return false;
  }

  /** If `input` is a call to remove, return the call, the range it occupies, and what it calls. */
  private matchCall(input: Node, scope: Scope): { call: Node; range: Node; method: string } | null {
    const range = input;
    const call = input.type === 'ChainExpression' ? input.expression : input;
    if (call.type !== 'CallExpression') return null;
    const method = this.calleeMethod(unwrap(call.callee), scope);
    if (method === null) return null;
    if (this.hasKeepComment(range.start)) return null;
    return { call, range, method };
  }

  private calleeMethod(callee: Node, scope: Scope): string | null {
    if (callee.type === 'Identifier') {
      const binding = scope.lookup(callee.name);
      if (binding?.kind === 'alias') return binding.method;
      if (!binding && this.opts.loggers.some((p) => p.length === 1 && p[0] === callee.name))
        return callee.name;
      return null;
    }
    if (callee.type !== 'MemberExpression') return null;
    const name = propertyName(callee);
    if (name === null) return null;
    if (this.opts.methods.has(name) && this.isConsole(callee.object, scope)) return name;

    const path = memberPath(callee);
    if (
      path &&
      this.opts.loggers.some(
        (p) => p.length === path.length && p.every((part, i) => part === path[i]),
      )
    ) {
      return path.join('.');
    }
    return null;
  }

  private hasKeepComment(start: number): boolean {
    const keep = this.opts.keepComment;
    if (!keep) return false;
    for (let i = this.comments.length - 1; i >= 0; i--) {
      const comment = this.comments[i] as Comment;
      if (comment.end > start) continue;
      if (this.code.slice(comment.end, start).trim() !== '') return false;
      if (comment.value.trim() === keep) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- editing

  private removeCall(
    { call, range, method }: { call: Node; range: Node; method: string },
    stmt: Node | null,
    parent: Node,
    key: string,
    scope: Scope,
  ): void {
    this.record(method, call.start);
    const kept: Node[] = call.arguments.filter(
      (arg: Node) => arg.type === 'SpreadElement' || !isPure(arg),
    );
    const open = (arg: Node) => (arg.type === 'SpreadElement' ? '[' : '');
    const close = (arg: Node) => (arg.type === 'SpreadElement' ? ']' : '');

    if (kept.length === 0) {
      if (stmt) this.removeStatement(stmt, parent);
      else
        this.s.overwrite(range.start, range.end, needsParens(parent, key) ? '(void 0)' : 'void 0');
      return;
    }

    const first = kept[0] as Node;
    const last = kept.at(-1) as Node;
    for (let i = 1; i < kept.length; i++) {
      const prev = kept[i - 1] as Node;
      const next = kept[i] as Node;
      this.s.overwrite(prev.end, next.start, `${close(prev)}, ${open(next)}`);
    }

    if (stmt) {
      // `console.log(i++)` -> `i++;`. Parenthesise when the kept code could not start a statement,
      // and guard against the previous line running into a leading `(` or `[`.
      const parens =
        first.type !== 'SpreadElement' && UNSAFE_STATEMENT_START.has(leftmost(first).type);
      let prefix = `${parens ? '(' : ''}${open(first)}`;
      if (/^[([]/.test(prefix) && this.continuesPrevious(stmt.start)) prefix = `;${prefix}`;
      this.s.overwrite(stmt.start, first.start, prefix);
      this.s.overwrite(last.end, stmt.end, `${close(last)}${parens ? ')' : ''};`);
    } else {
      this.s.overwrite(range.start, first.start, `(${open(first)}`);
      this.s.overwrite(last.end, range.end, `${close(last)}, void 0)`);
    }

    for (const arg of kept) this.visit(arg, call, 'arguments', scope);
  }

  /** Whether code starting at `offset` could be parsed as a continuation of the previous line. */
  private continuesPrevious(offset: number): boolean {
    let i = offset - 1;
    while (i >= 0 && /\s/.test(this.code[i] as string)) i--;
    return i >= 0 && !';{}'.includes(this.code[i] as string);
  }

  /** Delete a statement, taking its line with it when nothing else is on that line. */
  private removeStatement(stmt: Node, parent: Node): void {
    if (!STATEMENT_LISTS.has(parent.type)) {
      this.s.overwrite(stmt.start, stmt.end, ';');
      return;
    }
    const code = this.code;
    const lineStart = code.lastIndexOf('\n', stmt.start - 1) + 1;
    const ownLine = code.slice(lineStart, stmt.start).trim() === '';
    let end = stmt.end;
    while (code[end] === ' ' || code[end] === '\t') end++;
    if (code[end] === '\r') end++;
    if (ownLine && code[end] === '\n') {
      this.s.remove(lineStart, end + 1);
    } else {
      this.s.remove(stmt.start, stmt.end);
    }
  }

  /** Remove some items of a comma-separated list, keeping the commas valid. */
  private removeListItems(items: Node[], remove: Set<number>): void {
    let lastKept = -1;
    items.forEach((_, i) => {
      if (!remove.has(i)) lastKept = i;
    });
    items.forEach((item, i) => {
      if (!remove.has(i)) return;
      if (i < lastKept) this.s.remove(item.start, (items[i + 1] as Node).start);
      else this.s.remove((items[i - 1] as Node).end, item.end);
    });
  }

  private record(method: string, offset: number): void {
    if (!this.lineStarts) {
      this.lineStarts = [0];
      for (let i = 0; i < this.code.length; i++)
        if (this.code[i] === '\n') this.lineStarts.push(i + 1);
    }
    let lo = 0;
    let hi = this.lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((this.lineStarts[mid] as number) <= offset) lo = mid;
      else hi = mid - 1;
    }
    this.removed.push({ method, line: lo + 1, column: offset - (this.lineStarts[lo] as number) });
  }
}

/** The node that supplies the first token of an expression, e.g. the function in `function () {}()`. */
function leftmost(node: Node): Node {
  switch (node.type) {
    case 'CallExpression':
    case 'NewExpression':
      return node.type === 'CallExpression' ? leftmost(node.callee) : node;
    case 'MemberExpression':
      return leftmost(node.object);
    case 'TaggedTemplateExpression':
      return leftmost(node.tag);
    case 'BinaryExpression':
    case 'LogicalExpression':
    case 'AssignmentExpression':
      return leftmost(node.left);
    case 'ConditionalExpression':
      return leftmost(node.test);
    case 'SequenceExpression':
      return leftmost(node.expressions[0]);
    case 'UpdateExpression':
      return node.prefix ? node : leftmost(node.argument);
    case 'ChainExpression':
    case 'TSAsExpression':
    case 'TSSatisfiesExpression':
    case 'TSNonNullExpression':
      return leftmost(node.expression);
    default:
      return node;
  }
}

/** Positions where a bare `void 0` would parse differently, e.g. `void 0.foo`. */
function needsParens(parent: Node, key: string): boolean {
  if (parent.type === 'MemberExpression') return key === 'object';
  if (parent.type === 'CallExpression' || parent.type === 'NewExpression') return key === 'callee';
  return parent.type === 'TaggedTemplateExpression' && key === 'tag';
}

/** `['logger', 'debug']` for `logger.debug`; `null` when any part is not a static name. */
function memberPath(node: Node): string[] | null {
  const current = unwrap(node);
  if (current.type === 'Identifier') return [current.name];
  if (current.type === 'ThisExpression') return ['this'];
  if (current.type !== 'MemberExpression') return null;
  const name = propertyName(current);
  const base = memberPath(current.object);
  return name !== null && base ? [...base, name] : null;
}

/** Whether an identifier at `parent[key]` reads a variable (as opposed to naming a property or label). */
function isReference(parent: Node, key: string): boolean {
  switch (parent.type) {
    case 'MemberExpression':
      return key !== 'property' || parent.computed;
    case 'Property':
    case 'MethodDefinition':
    case 'PropertyDefinition':
    case 'AccessorProperty':
      return key !== 'key' || parent.computed;
    case 'LabeledStatement':
    case 'BreakStatement':
    case 'ContinueStatement':
      return false;
    case 'ImportSpecifier':
    case 'ImportDefaultSpecifier':
    case 'ImportNamespaceSpecifier':
      return false;
    case 'ExportSpecifier':
      return key === 'local';
    case 'MetaProperty':
      return false;
    default:
      return true;
  }
}
