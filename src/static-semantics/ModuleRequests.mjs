import { StringValue } from './all.mjs';

export function ModuleRequests(node) {
  switch (node.type) {
    case 'Module':
      if (node.ModuleBody) {
        return ModuleRequests(node.ModuleBody);
      }
      return [];
    case 'ModuleBody': {
      const moduleRequests = new Map(/* specifier -> Module Request */);
      for (const item of node.ModuleItemList) {
        for (const mr of ModuleRequests(item)) {
          const mr2 = moduleRequests.get(mr.Specifier.stringValue());
          if (!mr2) {
            moduleRequests.set(mr.Specifier.stringValue(), mr);
          } else if (mr2.Phase === 'defer' && mr.Phase === 'full') {
            mr2.Phase = 'full';
          }
        }
      }
      return Array.from(moduleRequests.values());
    }
    case 'ImportDeclaration': {
      const phase = node.Defer ? 'defer' : 'full';
      const specifier = StringValue(node.ModuleSpecifier || node.FromClause);
      return [{ Specifier: specifier, Phase: phase }];
    }
    case 'ExportDeclaration':
      if (node.FromClause) {
        return [{ Specifier: StringValue(node.FromClause), Phase: 'full' }];
      }
      return [];
    default:
      return [];
  }
}
