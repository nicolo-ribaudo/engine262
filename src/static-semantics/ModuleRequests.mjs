import { StringValue } from './all.mjs';

export function ModuleRequests(node, defer = false) {
  switch (node.type) {
    case 'Module':
      if (node.ModuleBody) {
        return ModuleRequests(node.ModuleBody);
      }
      return [];
    case 'ModuleBody': {
      const moduleNames = [];
      for (const item of node.ModuleItemList) {
        moduleNames.push(...ModuleRequests(item));
      }
      return moduleNames;
    }
    case 'ImportDeclaration':
      if (node.FromClause) {
        return ModuleRequests(node.FromClause, node.Defer);
      }
      return [{ Defer: node.Defer, Specifier: StringValue(node.ModuleSpecifier) }];
    case 'ExportDeclaration':
      if (node.FromClause) {
        return ModuleRequests(node.FromClause, node.Defer);
      }
      return [];
    case 'StringLiteral':
      return [{ Defer: defer, Specifier: StringValue(node) }];
    default:
      return [];
  }
}
