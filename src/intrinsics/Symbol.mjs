import {
  SymbolValue,
  New as NewValue,
} from '../value.mjs';

import {
  Type,
  SameValue,
  ToString,
  CreateBuiltinFunction,
} from '../engine.mjs';

export const GlobalSymbolRegistry = [];

function SymbolConstructor(realm, [description], { NewTarget }) {
  if (NewTarget !== undefined) {
    realm.exception.TypeError();
  }
  const descString = description.value === undefined ?
    NewValue(undefined) :
    ToString(description);

  const val = new SymbolValue(realm);
  val.Description = descString;
}

function SymbolFor(realm, [key]) {
  const stringKey = ToString(key);
  for (const e of GlobalSymbolRegistry) {
    if (SameValue(e.Key, stringKey)) {
      return e.Symbol;
    }
  }
  // Assert: GlobalSymbolRegistry does not currently contain an entry for stringKey.
  const newSymbol = new SymbolValue(realm, stringKey);
  GlobalSymbolRegistry.push({ Key: stringKey, Symbol: newSymbol });
  return newSymbol;
}

function SymbolKeyFor(realm, [sym]) {
  if (Type(sym) !== 'Symbol') {
    realm.exception.TypeError();
  }
  for (const e of GlobalSymbolRegistry) {
    if (SameValue(e.Symbol, sym)) {
      return e.Key;
    }
  }
  return NewValue(undefined);
}

export function CreateSymbol(realmRec) {
  const symbolConstructor = CreateBuiltinFunction(SymbolConstructor, [], realmRec);

  [
    ['for', SymbolFor],
    ['keyFor', SymbolKeyFor],
  ].forEach(([name, fn]) => {
    symbolConstructor.DefineOwnProperty(NewValue(name), {
      Value: CreateBuiltinFunction(fn, [], realmRec),
      Writable: true,
      Enumerable: false,
      Configurable: true,
    });
  });

  realmRec.Intrinsics['%SymbolPrototype%'].DefineOwnProperty(
    NewValue('constructor'), {
      Value: symbolConstructor,
      Writable: true,
      Enumerable: false,
      Configurable: true,
    },
  );

  realmRec.Intrinsics['%Symbol%'] = symbolConstructor;
}
