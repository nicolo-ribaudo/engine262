import type { ParseNode } from '../parser/ParseNode.mts';
import type { JSStringValue } from '../value.mts';
import { StringValue } from './all.mts';
import { surroundingAgent, type LoadedModuleRequestRecord, type Mutable } from '#self';

// https://tc39.es/ecma262/#modulerequest-record
export interface ModuleRequestRecord {
  readonly Specifier: JSStringValue;
  readonly Attributes: ImportAttributeRecord[];
  /* [import-defer] */ readonly Phase: 'defer' | 'evaluation';
  /* [export-defer] */ readonly ImportedNames?: 'all' | string[];
}

// https://tc39.es/ecma262/#importattribute-record
export interface ImportAttributeRecord {
  readonly Key: JSStringValue;
  readonly Value: JSStringValue;
}

function stringsEqual(left: JSStringValue, right: JSStringValue) {
  return left === right || left.stringValue() === right.stringValue();
}

// https://tc39.es/ecma262/#sec-ModuleRequestsEqual
export function ModuleRequestsEqual(left: ModuleRequestRecord | LoadedModuleRequestRecord, right: ModuleRequestRecord | LoadedModuleRequestRecord) {
  if (!stringsEqual(left.Specifier, right.Specifier)) {
    return false;
  }
  const leftAttrs = left.Attributes;
  const rightAttrs = right.Attributes;
  const leftAttrsCount = leftAttrs.length;
  const rightAttrsCount = rightAttrs.length;
  if (leftAttrsCount !== rightAttrsCount) {
    return false;
  }
  for (const l of leftAttrs) {
    if (!rightAttrs.some((r) => stringsEqual(l.Key, r.Key) && stringsEqual(l.Value, r.Value))) {
      return false;
    }
  }
  return true;
}

// https://tc39.es/ecma262/#sec-withclausetoattributes
function WithClauseToAttributes(node: ParseNode.WithClause): ImportAttributeRecord[] {
  const attributes: ImportAttributeRecord[] = [];
  for (const attribute of node.WithEntries) {
    attributes.push({
      Key: StringValue(attribute.AttributeKey),
      Value: StringValue(attribute.AttributeValue),
    });
  }
  attributes.sort((a, b) => (a.Key.value < b.Key.value ? -1 : 1));
  return attributes;
}

export function ModuleRequests(node: ParseNode, /* [export-defer] */ exportDefer: 'exclude-export-defer' | 'include-export-defer' = 'exclude-export-defer'): ModuleRequestRecord[] {
  switch (node.type) {
    case 'Module':
      if (node.ModuleBody) {
        return ModuleRequests(node.ModuleBody);
      }
      return [];
    case 'ModuleBody': {
      const requests: ModuleRequestRecord[] = [];
      for (const item of node.ModuleItemList) {
        const additionalRequests = ModuleRequests(item);
        for (const mr of additionalRequests) {
          if (surroundingAgent.feature('export-defer')) {
            const existingRequest = requests.find((r) => ModuleRequestsEqual(r, mr) && r.Phase === mr.Phase);
            if (existingRequest) {
              (existingRequest as Mutable<ModuleRequestRecord>).ImportedNames = MergeImportedNames(existingRequest.ImportedNames!, mr.ImportedNames!);
            } else {
              requests.push(mr);
            }
          } else {
            if (!requests.some((r) => ModuleRequestsEqual(r, mr)
                && (surroundingAgent.feature('import-defer') ? r.Phase === mr.Phase : true))
            ) {
              requests.push(mr);
            }
          }
        }
      }
      return requests;
    }
    case 'ImportDeclaration':
      if (node.FromClause) {
        const specifier = StringValue(node.FromClause);
        const attributes = node.WithClause ? WithClauseToAttributes(node.WithClause) : [];
        return [{
          Specifier: specifier,
          Attributes: attributes,
          /* [import-defer] */ Phase: node.Phase,
          /* [export-defer] */ ImportedNames: surroundingAgent.feature('export-defer') ? ImportedNames(node.ImportClause!) : undefined,
        }];
      }
      if (node.ModuleSpecifier) {
        const specifier = StringValue(node.ModuleSpecifier);
        const attributes = node.WithClause ? WithClauseToAttributes(node.WithClause) : [];
        return [{
          Specifier: specifier,
          Attributes: attributes,
          /* [import-defer] */ Phase: node.Phase,
          /* [export-defer] */ ImportedNames: surroundingAgent.feature('export-defer') ? [] : undefined,
        }];
      }
      throw new Error('Unreachable: all imports must have either an ImportClause or a ModuleSpecifier');
    case 'ExportDeclaration':
      if (node.FromClause) {
        if (surroundingAgent.feature('export-defer') && node.Phase === 'defer' && exportDefer === 'exclude-export-defer') {
          return [];
        }

        const specifier = StringValue(node.FromClause);
        const attributes = node.WithClause ? WithClauseToAttributes(node.WithClause) : [];
        return [{
          Specifier: specifier,
          Attributes: attributes,
          /* [import-defer] */ Phase: 'evaluation',
          /* [export-defer] */ ImportedNames: surroundingAgent.feature('export-defer') ? ImportedNames(node.ExportFromClause!) : undefined,
        }];
      }
      return [];
    default:
      return [];
  }
}

function ImportedNames(node: ParseNode): 'all' | string[] {
  switch (node.type) {
    case 'ImportClause': {
      if (node.NameSpaceImport) {
        return 'all';
      }
      let names: string[] = [];
      if (node.NamedImports) {
        names = ImportedNames(node.NamedImports) as string[];
      }
      if (node.ImportedDefaultBinding) {
        names.push('default');
      }
      return names;
    }
    case 'NamedImports':
      return node.ImportsList.flatMap(ImportedNames);
    case 'NamedExports':
      return node.ExportsList.flatMap(ImportedNames);
    case 'ExportFromClause':
      return 'all';
    case 'ImportSpecifier':
      if (node.ModuleExportName) {
        return ImportedNames(node.ModuleExportName);
      }
      return [StringValue(node.ImportedBinding).value];
    case 'ExportSpecifier':
      return [StringValue(node.localName).value];

    default:
      return [];
  }
}

/* [export-defer] https://tc39.es/proposal-deferred-reexports/#sec-mergeimportednames */
export function MergeImportedNames(a: 'all' | string[], b: 'all' | string[]) {
  if (a === 'all' || b === 'all') {
    return 'all';
  }
  return a.concat(b);
}
