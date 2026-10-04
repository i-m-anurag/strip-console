/** Loose ESTree node shape as produced by oxc-parser (offsets are UTF-16). */
// biome-ignore lint/suspicious/noExplicitAny: AST nodes are walked generically
export type Node = { type: string; start: number; end: number } & Record<string, any>;

export function isNode(value: unknown): value is Node {
  return typeof value === 'object' && value !== null && typeof (value as Node).type === 'string';
}

/** Child nodes of `node`, in source order. */
export function children(node: Node): Node[] {
  const out: Node[] = [];
  for (const key in node) {
    if (key === 'type' || key === 'start' || key === 'end') continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const item of value) if (isNode(item)) out.push(item);
    } else if (isNode(value)) {
      out.push(value);
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Static property name of a member expression, e.g. `log` in `console.log` or `console['log']`. */
export function propertyName(member: Node): string | null {
  const prop = member.property;
  if (!member.computed && prop.type === 'Identifier') return prop.name;
  if (member.computed && prop.type === 'Literal' && typeof prop.value === 'string')
    return prop.value;
  if (
    member.computed &&
    prop.type === 'TemplateLiteral' &&
    prop.expressions.length === 0 &&
    prop.quasis.length === 1
  ) {
    return prop.quasis[0].value.cooked ?? null;
  }
  return null;
}

/** Strip wrappers that do not change runtime meaning: parentheses and TS-only expressions. */
export function unwrap(node: Node): Node {
  let current = node;
  while (
    current.type === 'ParenthesizedExpression' ||
    current.type === 'TSAsExpression' ||
    current.type === 'TSSatisfiesExpression' ||
    current.type === 'TSNonNullExpression' ||
    current.type === 'TSTypeAssertion'
  ) {
    current = current.expression;
  }
  return current;
}
