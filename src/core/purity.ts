import { type Node, unwrap } from './ast';

/**
 * True when evaluating `node` cannot have side effects, so it can be dropped
 * together with the console call that receives it. Property reads are treated
 * as pure (getters are assumed side-effect free), matching common minifier
 * behaviour. Anything unknown is treated as impure and kept.
 */
export function isPure(input: Node | null): boolean {
  if (input === null) return true; // array hole
  const node = unwrap(input);
  switch (node.type) {
    case 'Literal':
    case 'Identifier':
    case 'ThisExpression':
    case 'Super':
    case 'MetaProperty':
    case 'ArrowFunctionExpression':
    case 'FunctionExpression':
      return true;
    case 'TemplateLiteral':
      return node.expressions.every(isPure);
    case 'UnaryExpression':
      return node.operator !== 'delete' && isPure(node.argument);
    case 'BinaryExpression':
    case 'LogicalExpression':
      return isPure(node.left) && isPure(node.right);
    case 'ConditionalExpression':
      return isPure(node.test) && isPure(node.consequent) && isPure(node.alternate);
    case 'SequenceExpression':
      return node.expressions.every(isPure);
    case 'ArrayExpression':
      return node.elements.every(
        (el: Node | null) => el === null || (el.type !== 'SpreadElement' && isPure(el)),
      );
    case 'ObjectExpression':
      return node.properties.every(
        (prop: Node) =>
          prop.type === 'Property' && (!prop.computed || isPure(prop.key)) && isPure(prop.value),
      );
    case 'MemberExpression':
      return isPure(node.object) && (!node.computed || isPure(node.property));
    case 'ChainExpression':
      return isPure(node.expression);
    default:
      return false;
  }
}
