import { StringValue } from './all.mjs';

export function ModuleRequests(node, defer = false) {
  switch (node.type) {
    case 'Module':
      if (node.ModuleBody) {
        return ModuleRequests(node.ModuleBody);
      }
      return [];
    case 'ModuleBody': {
      const moduleRequests = new Map(/* specifier -> Module Request */);
      for (const item of node.ModuleItemList) {
        for (const request of ModuleRequests(item)) {
          const existingRequest = moduleRequests.get(request.Specifier.stringValue());
          if (existingRequest) {
            existingRequest.Defer = existingRequest.Defer && request.Defer;
          } else {
            moduleRequests.set(request.Specifier.stringValue(), request);
          }
        }
      }
      return Array.from(moduleRequests.values());
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
