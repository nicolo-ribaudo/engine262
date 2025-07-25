import { AbstractModuleRecord } from './modules.mts';
import {
  Descriptor,
  ReferenceRecord,
  UndefinedValue,
  ObjectValue,
  Value,
  wellKnownSymbols,
  BooleanValue,
  JSStringValue,
  PrivateName,
  NullValue,
} from './value.mts';
import { surroundingAgent, type GCMarker } from './host-defined/engine.mts';
import {
  Assert,
  DefinePropertyOrThrow,
  Get,
  HasOwnProperty,
  HasProperty,
  IsDataDescriptor,
  IsExtensible,
  IsPropertyKey,
  Set,
  ToBoolean,
  isECMAScriptFunctionObject,
  type ECMAScriptFunctionObject,
} from './abstract-ops/all.mts';
import {
  NormalCompletion, Q, X,
  type ValueEvaluator,
} from './completion.mts';
import { JSStringMap, skipDebugger } from './helpers.mts';
import type { PlainEvaluator } from './evaluator.mts';

/** https://tc39.es/ecma262/#sec-environment-records */
export abstract class EnvironmentRecord {
  readonly OuterEnv: EnvironmentRecord | NullValue;

  constructor(outerEnv: EnvironmentRecord | NullValue) {
    this.OuterEnv = outerEnv;
  }

  abstract HasBinding(N: JSStringValue): ValueEvaluator<BooleanValue>;

  abstract CreateMutableBinding(N: JSStringValue, D: BooleanValue): PlainEvaluator;

  abstract CreateImmutableBinding(N: JSStringValue, S: BooleanValue): void;

  abstract InitializeBinding(N: JSStringValue, V: Value): PlainEvaluator;

  abstract SetMutableBinding(N: JSStringValue, V: Value, S: BooleanValue): PlainEvaluator;

  abstract GetBindingValue(N: JSStringValue, S: BooleanValue): ValueEvaluator;

  abstract DeleteBinding(N: JSStringValue): ValueEvaluator<BooleanValue>;

  abstract HasThisBinding(): BooleanValue;

  abstract HasSuperBinding(): BooleanValue;

  abstract WithBaseObject(): ObjectValue | UndefinedValue;

  // NON-SPEC
  mark(m: GCMarker) {
    m(this.OuterEnv);
  }
}

interface DeclarativeEnvironmentBinding {
  readonly indirect: boolean;
  initialized: boolean;
  readonly mutable?: boolean;
  readonly strict?: boolean;
  readonly deletable?: boolean;
  value?: Value | undefined;

  mark(m: GCMarker): void;
}

interface ModuleEnvironmentBinding extends DeclarativeEnvironmentBinding {
  readonly target: [AbstractModuleRecord, JSStringValue];
}
/** https://tc39.es/ecma262/#sec-declarative-environment-records */
export class DeclarativeEnvironmentRecord extends EnvironmentRecord {
  readonly bindings = new JSStringMap<DeclarativeEnvironmentBinding>();

  /** https://tc39.es/ecma262/#sec-declarative-environment-records-hasbinding-n */
  * HasBinding(N: JSStringValue) {
    // 1. Let envRec be the declarative Environment Record for which the method was invoked.
    const envRec = this;
    // 2. If envRec has a binding for the name that is the value of N, return true.
    if (envRec.bindings.has(N)) {
      return Value.true;
    }
    // 3. Return false.
    return Value.false;
  }

  /** https://tc39.es/ecma262/#sec-declarative-environment-records-createmutablebinding-n-d */
  * CreateMutableBinding(N: JSStringValue, D: BooleanValue) {
    // 1. Let envRec be the declarative Environment Record for which the method was invoked.
    const envRec = this;
    // 2. Assert: envRec does not already have a binding for N.
    Assert(!envRec.bindings.has(N));
    // 3. Create a mutable binding in envRec for N and record that it is uninitialized. If D
    //    is true, record that the newly created binding may be deleted by a subsequent
    //    DeleteBinding call.
    this.bindings.set(N, {
      indirect: false,
      initialized: false,
      mutable: true,
      strict: undefined,
      deletable: D === Value.true,
      value: undefined,
      mark(m: GCMarker) {
        m(this.value);
      },
    });
    //  4. Return NormalCompletion(empty).
    return NormalCompletion(undefined);
  }

  /** https://tc39.es/ecma262/#sec-declarative-environment-records-createimmutablebinding-n-s */
  CreateImmutableBinding(N: JSStringValue, S: BooleanValue) {
    // 1. Let envRec be the declarative Environment Record for which the method was invoked.
    const envRec = this;
    // 2. Assert: envRec does not already have a binding for N.
    Assert(!envRec.bindings.has(N));
    // 3. Create an immutable binding in envRec for N and record that it is uninitialized. If
    //    S is true, record that the newly created binding is a strict binding.
    this.bindings.set(N, {
      indirect: false,
      initialized: false,
      mutable: false,
      strict: S === Value.true,
      deletable: false,
      value: undefined,
      mark(m) {
        m(this.value);
      },
    });
    // 4. Return NormalCompletion(empty).
    return NormalCompletion(undefined);
  }

  /** https://tc39.es/ecma262/#sec-declarative-environment-records-initializebinding-n-v */
  * InitializeBinding(N: JSStringValue, V: Value) {
    // 1. Let envRec be the declarative Environment Record for which the method was invoked.
    const envRec = this;
    // 2. Assert: envRec must have an uninitialized binding for N.
    const binding = envRec.bindings.get(N);
    Assert(binding !== undefined && binding.initialized === false);
    // 3. Set the bound value for N in envRec to V.
    binding.value = V;
    // 4. Record that the binding for N in envRec has been initialized.
    binding.initialized = true;
    // 5. Return NormalCompletion(empty).
    return NormalCompletion(undefined);
  }

  /** https://tc39.es/ecma262/#sec-declarative-environment-records-setmutablebinding-n-v-s */
  * SetMutableBinding(N: JSStringValue, V: Value, S: BooleanValue): PlainEvaluator {
    Assert(IsPropertyKey(N));
    // 1. Let envRec be the declarative Environment Record for which the method was invoked.
    const envRec = this;
    // 2. If envRec does not have a binding for N, then
    if (!envRec.bindings.has(N)) {
      // a. If S is true, throw a ReferenceError exception.
      if (S === Value.true) {
        return surroundingAgent.Throw('ReferenceError', 'NotDefined', N);
      }
      // b. Perform envRec.CreateMutableBinding(N, true).
      yield* envRec.CreateMutableBinding(N, Value.true);
      // c. Perform envRec.InitializeBinding(N, V).
      yield* envRec.InitializeBinding(N, V);
      // d. Return NormalCompletion(empty).
      return NormalCompletion(undefined);
    }
    const binding = this.bindings.get(N)!;
    // 3. If the binding for N in envRec is a strict binding, set S to true.
    if (binding.strict === true) {
      S = Value.true;
    }
    // 4. If the binding for N in envRec has not yet been initialized, throw a ReferenceError exception.
    if (binding.initialized === false) {
      return surroundingAgent.Throw('ReferenceError', 'NotInitialized', N);
    }
    // 5. Else if the binding for N in envRec is a mutable binding, change its bound value to V.
    if (binding.mutable === true) {
      binding.value = V;
    } else {
      // a. Assert: This is an attempt to change the value of an immutable binding.
      // b. If S is true, throw a TypeError exception.
      if (S === Value.true) {
        return surroundingAgent.Throw('TypeError', 'AssignmentToConstant', N);
      }
    }
    // 7. Return NormalCompletion(empty).
    return NormalCompletion(undefined);
  }

  /** https://tc39.es/ecma262/#sec-declarative-environment-records-getbindingvalue-n-s */
  * GetBindingValue(N: JSStringValue, _S: BooleanValue): ValueEvaluator {
    // 1. Let envRec be the declarative Environment Record for which the method was invoked.
    const envRec = this;
    // 2. Assert: envRec has a binding for N.
    const binding = envRec.bindings.get(N);
    Assert(binding !== undefined);
    // 3. If the binding for N in envRec is an uninitialized binding, throw a ReferenceError exception.
    if (binding.initialized === false) {
      return surroundingAgent.Throw('ReferenceError', 'NotInitialized', N);
    }
    // 4. Return the value currently bound to N in envRec.
    return NormalCompletion(binding.value!);
  }

  /** https://tc39.es/ecma262/#sec-declarative-environment-records-deletebinding-n */
  * DeleteBinding(N: JSStringValue) {
    // 1. Let envRec be the declarative Environment Record for which the method was invoked.
    const envRec = this;
    // 2. Assert: envRec has a binding for the name that is the value of N.
    const binding = envRec.bindings.get(N);
    Assert(binding !== undefined);
    // 3. If the binding for N in envRec cannot be deleted, return false.
    if (binding.deletable === false) {
      return Value.false;
    }
    // 4. Remove the binding for N from envRec.
    envRec.bindings.delete(N);
    // 5. Return true.
    return Value.true;
  }

  /** https://tc39.es/ecma262/#sec-declarative-environment-records-hasthisbinding */
  HasThisBinding(): BooleanValue {
    // 1. Return false.
    return Value.false;
  }

  /** https://tc39.es/ecma262/#sec-declarative-environment-records-hassuperbinding */
  HasSuperBinding(): BooleanValue {
    // 1. Return false.
    return Value.false;
  }

  /** https://tc39.es/ecma262/#sec-declarative-environment-records-withbaseobject */
  WithBaseObject() {
    // 1. Return undefined.
    return Value.undefined;
  }

  // NON-SPEC
  override mark(m: GCMarker) {
    // TODO(ts): this function does not call super.mark(). is it a mistake?
    m(this.bindings);
  }
}

/** https://tc39.es/ecma262/#sec-object-environment-records */
export class ObjectEnvironmentRecord extends EnvironmentRecord {
  BindingObject: ObjectValue;

  IsWithEnvironment: BooleanValue;

  /** https://tc39.es/ecma262/#sec-newobjectenvironment */
  constructor(O: ObjectValue, W: BooleanValue, E: EnvironmentRecord | NullValue) {
    super(E);
    this.BindingObject = O;
    this.IsWithEnvironment = W;
  }

  /** https://tc39.es/ecma262/#sec-object-environment-records-hasbinding-n */
  * HasBinding(N: JSStringValue): ValueEvaluator<BooleanValue> {
    // 1. Let envRec be the object Environment Record for which the method was invoked.
    const envRec = this;
    // 2. Let bindings be the binding object for envRec.
    const bindings = envRec.BindingObject;
    // 3. Let foundBinding be ? HasProperty(bindings, N).
    const foundBinding = Q(yield* HasProperty(bindings, N));
    // 4. If foundBinding is false, return false.
    if (foundBinding === Value.false) {
      return Value.false;
    }
    // 5. If the IsWithEnvironment flag of envRec i s false, return true.
    if (envRec.IsWithEnvironment === Value.false) {
      return Value.true;
    }
    // 6. Let unscopables be ? Get(bindings, @@unscopables).
    const unscopables = Q(yield* Get(bindings, wellKnownSymbols.unscopables));
    // 7. If Type(unscopables) is Object, then
    if (unscopables instanceof ObjectValue) {
      // a. Let blocked be ! ToBoolean(? Get(unscopables, N)).
      const blocked = X(ToBoolean(Q(yield* Get(unscopables, N))));
      // b. If blocked is true, return false.
      if (blocked === Value.true) {
        return Value.false;
      }
    }
    // 8. Return true.
    return Value.true;
  }

  /** https://tc39.es/ecma262/#sec-object-environment-records-createmutablebinding-n-d */
  * CreateMutableBinding(N: JSStringValue, D: BooleanValue): PlainEvaluator {
    // 1. Let envRec be the object Environment Record for which the method was invoked.
    const envRec = this;
    // 2. Let envRec be the object Environment Record for which the method was invoked.
    const bindings = envRec.BindingObject;
    // 3. Return ? DefinePropertyOrThrow(bindings, N, PropertyDescriptor { [[Value]]: undefined, [[Writable]]: true, [[Enumerable]]: true, [[Configurable]]: D }).
    Q(yield* DefinePropertyOrThrow(bindings, N, Descriptor({
      Value: Value.undefined,
      Writable: Value.true,
      Enumerable: Value.true,
      Configurable: D,
    })));
  }

  /** https://tc39.es/ecma262/#sec-object-environment-records-createimmutablebinding-n-s */
  CreateImmutableBinding(_N: JSStringValue, _S: BooleanValue) {
    Assert(false, 'CreateImmutableBinding called on an Object Environment Record');
  }

  /** https://tc39.es/ecma262/#sec-object-environment-records-initializebinding-n-v */
  * InitializeBinding(N: JSStringValue, V: Value): PlainEvaluator {
    // 1. Let envRec be the object Environment Record for which the method was invoked.
    const envRec = this;
    // 2. Assert: envRec must have an uninitialized binding for N.
    // 3. Record that the binding for N in envRec has been initialized.
    // 4. Return ? envRec.SetMutableBinding(N, V, false).
    Q(yield* envRec.SetMutableBinding(N, V, Value.false));
  }

  /** https://tc39.es/ecma262/#sec-object-environment-records-setmutablebinding-n-v-s */
  * SetMutableBinding(N: JSStringValue, V: Value, S: BooleanValue): PlainEvaluator {
    // 1. Let envRec be the object Environment Record for which the method was invoked.
    const envRec = this;
    // 2. Let bindings be the binding object for envRec.
    const bindings = envRec.BindingObject;
    // 3. Let stillExists be ? HasProperty(bindings, N).
    const stillExists = Q(yield* HasProperty(bindings, N));
    // 4. If stillExists is false and S is true, throw a ReferenceError exception.
    if (stillExists === Value.false && S === Value.true) {
      return surroundingAgent.Throw('ReferenceError', 'NotDefined', N);
    }
    // 5. Return ? Set(bindings, N, V, S).
    Q(yield* Set(bindings, N, V, S));
    return undefined;
  }

  /** https://tc39.es/ecma262/#sec-object-environment-records-getbindingvalue-n-s */
  * GetBindingValue(N: JSStringValue, S: BooleanValue): ValueEvaluator {
    // 1. Let envRec be the object Environment Record for which the method was invoked.
    const envRec = this;
    // 2. Let bindings be the binding object for envRec.
    const bindings = envRec.BindingObject;
    // 3. Let value be ? HasProperty(bindings, N).
    const value = Q(yield* HasProperty(bindings, N));
    // 4. If value is false, then
    if (value === Value.false) {
      // a. If S is false, return the value undefined; otherwise throw a ReferenceError exception.
      if (S === Value.false) {
        return NormalCompletion(Value.undefined);
      } else {
        return surroundingAgent.Throw('ReferenceError', 'NotDefined', N);
      }
    }
    // 5. Return Get(bindings, N).
    return yield* Get(bindings, N);
  }

  /** https://tc39.es/ecma262/#sec-object-environment-records-deletebinding-n */
  * DeleteBinding(N: JSStringValue): ValueEvaluator<BooleanValue> {
    // 1. Let envRec be the object Environment Record for which the method was invoked.
    const envRec = this;
    // 2. Let bindings be the binding object for envRec.
    const bindings = envRec.BindingObject;
    // 3. Return ? bindings.[[Delete]](N).
    return Q(yield* bindings.Delete(N));
  }

  /** https://tc39.es/ecma262/#sec-object-environment-records-hasthisbinding */
  HasThisBinding() {
    // 1. Return false.
    return Value.false;
  }

  /** https://tc39.es/ecma262/#sec-object-environment-records-hassuperbinding */
  HasSuperBinding() {
    // 1. Return falase.
    return Value.false;
  }

  /** https://tc39.es/ecma262/#sec-object-environment-records-withbaseobject */
  WithBaseObject() {
    // 1. Let envRec be the object Environment Record for which the method was invoked.
    const envRec = this;
    // 2. If the IsWithEnvironment flag of envRec is true, return the binding object for envRec.
    if (envRec.IsWithEnvironment === Value.true) {
      return envRec.BindingObject;
    }
    // 3. Otherwise, return undefined.
    return Value.undefined;
  }

  // NON-SPEC
  override mark(m: GCMarker) {
    // TODO(ts): this function does not call super.mark(). is it a mistake?
    m(this.BindingObject);
  }
}

/** https://tc39.es/ecma262/#sec-function-environment-records */
export class FunctionEnvironmentRecord extends DeclarativeEnvironmentRecord {
  /** https://tc39.es/ecma262/#sec-newfunctionenvironment */
  constructor(F: ECMAScriptFunctionObject, newTarget: UndefinedValue | ObjectValue) {
    // 1. Assert: F is an ECMAScript function.
    Assert(isECMAScriptFunctionObject(F));
    // 2. Assert: Type(newTarget) is Undefined or Object.
    Assert(newTarget instanceof UndefinedValue || newTarget instanceof ObjectValue);
    // 3. Let env be a new function Environment Record containing no bindings.
    super(F.Environment);
    // 4. Set env.[[FunctionObject]] to F.
    this.FunctionObject = F;
    // 5. If F.[[ThisMode]] is lexical, set env.[[ThisBindingStatus]] to lexical.

    if (F.ThisMode === 'lexical') {
      this.ThisBindingStatus = 'lexical';
    } else { // 6. Else, set env.[[ThisBindingStatus]] to uninitialized.
      this.ThisBindingStatus = 'uninitialized';
    }
    // 7. Set env.[[NewTarget]] to newTarget.
    this.NewTarget = newTarget;
    // 8. Set env.[[OuterEnv]] to F.[[Environment]].
    // 9. Return env.
  }

  protected ThisValue!: Value;

  ThisBindingStatus: 'lexical' | 'uninitialized' | 'initialized';

  readonly FunctionObject: ECMAScriptFunctionObject;

  readonly NewTarget: UndefinedValue | ObjectValue;

  /** https://tc39.es/ecma262/#sec-bindthisvalue */
  BindThisValue(V: Value) {
    // 1. Let envRec be the function Environment Record for which the method was invoked.
    const envRec = this;
    // 2. Assert: envRec.[[ThisBindingStatus]] is not lexical.
    Assert(envRec.ThisBindingStatus !== 'lexical');
    // 3. If envRec.[[ThisBindingStatus]] is initialized, throw a ReferenceError exception.
    if (envRec.ThisBindingStatus === 'initialized') {
      return surroundingAgent.Throw('ReferenceError', 'InvalidThis');
    }
    // 4. Set envRec.[[ThisValue]] to V.
    envRec.ThisValue = V;
    // 5. Set envRec.[[ThisBindingStatus]] to initialized.
    envRec.ThisBindingStatus = 'initialized';
    // 6. Return V.
    return V;
  }

  /** https://tc39.es/ecma262/#sec-function-environment-records-hasthisbinding */
  override HasThisBinding() {
    // 1. Let envRec be the function Environment Record for which the method was invoked.
    const envRec = this;
    // 2. If envRec.[[ThisBindingStatus]] is lexical, return false; otherwise, return true.
    if (envRec.ThisBindingStatus === 'lexical') {
      return Value.false;
    } else {
      return Value.true;
    }
  }

  /** https://tc39.es/ecma262/#sec-function-environment-records-hassuperbinding */
  override HasSuperBinding() {
    const envRec = this;
    // 1. If envRec.[[ThisBindingStatus]] is lexical, return false.
    if (envRec.ThisBindingStatus === 'lexical') {
      return Value.false;
    }
    // 2. If envRec.[[FunctionObject]].[[HomeObject]] has the value undefined, return false; otherwise, return true.
    if (envRec.FunctionObject.HomeObject === Value.undefined) {
      return Value.false;
    } else {
      return Value.true;
    }
  }

  /** https://tc39.es/ecma262/#sec-function-environment-records-getthisbinding */
  GetThisBinding() {
    // 1. Let envRec be the function Environment Record for which the method was invoked.
    const envRec = this;
    // 2. Assert: envRec.[[ThisBindingStatus]] is not lexical.
    Assert(envRec.ThisBindingStatus !== 'lexical');
    // 3. If envRec.[[ThisBindingStatus]] is uninitialized, throw a ReferenceError exception.
    if (envRec.ThisBindingStatus === 'uninitialized') {
      return surroundingAgent.Throw('ReferenceError', 'InvalidThis');
    }
    // 4. Return envRec.[[ThisValue]].
    return envRec.ThisValue;
  }

  /** https://tc39.es/ecma262/#sec-getsuperbase */
  GetSuperBase() {
    const envRec = this;
    // 1. Let home be envRec.[[FunctionObject]].[[HomeObject]].
    const home = envRec.FunctionObject.HomeObject;
    // 2. If home has the value undefined, return undefined.
    if (home === Value.undefined) {
      return Value.undefined;
    }
    // 3. Assert: Type(home) is Object.
    Assert(home instanceof ObjectValue);
    // 4. Return ! home.[[GetPrototypeOf]]().
    return X(home.GetPrototypeOf());
  }

  override mark(m: GCMarker) {
    super.mark(m);
    m(this.ThisValue);
    m(this.FunctionObject);
    m(this.NewTarget);
  }
}

/** https://tc39.es/ecma262/#sec-global-environment-records */
export class GlobalEnvironmentRecord extends EnvironmentRecord {
  readonly ObjectRecord: ObjectEnvironmentRecord;

  readonly GlobalThisValue: ObjectValue;

  readonly DeclarativeRecord: DeclarativeEnvironmentRecord;

  /** https://tc39.es/ecma262/#sec-newglobalenvironment */
  constructor(G: ObjectValue, thisValue: ObjectValue) {
    // 1. Let objRec be NewObjectEnvironment(G, false, null).
    const objRec = new ObjectEnvironmentRecord(G, Value.false, Value.null);
    // 2. Let dclRec be a new declarative Environment Record containing no bindings.
    const dclRec = new DeclarativeEnvironmentRecord(Value.null);
    // 3. Let env be a new global Environment Record.
    super(Value.null);
    // 4. Set env.[[ObjectRecord]] to objRec.
    this.ObjectRecord = objRec;
    // 5. Set env.[[GlobalThisValue]] to thisValue.
    this.GlobalThisValue = thisValue;
    // 6. Set env.[[DeclarativeRecord]] to dclRec.
    this.DeclarativeRecord = dclRec;
    // 8. Set env.[[OuterEnv]] to null.
    // 9. Return env.
  }

  /** https://tc39.es/ecma262/#sec-global-environment-records-hasbinding-n */
  * HasBinding(N: JSStringValue) {
    // 1. Let envRec be the global Environment Record for which the method was invoked.
    const envRec = this;
    // 2. Let DclRec be envRec.[[DeclarativeRecord]].
    const DclRec = envRec.DeclarativeRecord;
    // 3. If DclRec.HasBinding(N) is true, return true.
    if ((yield* DclRec.HasBinding(N)) === Value.true) {
      return Value.true;
    }
    // 4. If DclRec.HasBinding(N) is true, return true.
    const ObjRec = envRec.ObjectRecord;
    // 5. Let ObjRec be envRec.[[ObjectRecord]].
    return yield* ObjRec.HasBinding(N);
  }

  /** https://tc39.es/ecma262/#sec-global-environment-records-createmutablebinding-n-d */
  * CreateMutableBinding(N: JSStringValue, D: BooleanValue) {
    // 1. Let envRec be the global Environment Record for which the method was invoked.
    const envRec = this;
    // 2. Let DclRec be envRec.[[DeclarativeRecord]].
    const DclRec = envRec.DeclarativeRecord;
    // 3. If DclRec.HasBinding(N) is true, throw a TypeError exception.
    if ((yield* DclRec.HasBinding(N)) === Value.true) {
      return surroundingAgent.Throw('TypeError', 'AlreadyDeclared', N);
    }
    // 4. Return DclRec.CreateMutableBinding(N, D).
    return yield* DclRec.CreateMutableBinding(N, D);
  }

  /** https://tc39.es/ecma262/#sec-global-environment-records-createimmutablebinding-n-s */
  CreateImmutableBinding(N: JSStringValue, S: BooleanValue) {
    // 1. Let envRec be the global Environment Record for which the method was invoked.
    const envRec = this;
    // 2. Let DclRec be envRec.[[DeclarativeRecord]].
    const DclRec = envRec.DeclarativeRecord;
    // 3. If DclRec.HasBinding(N) is true, throw a TypeError exception.
    // TODO: remove skipDebugger
    if (skipDebugger(DclRec.HasBinding(N)) === Value.true) {
      return surroundingAgent.Throw('TypeError', 'AlreadyDeclared', N);
    }
    // Return DclRec.CreateImmutableBinding(N, S).
    return DclRec.CreateImmutableBinding(N, S);
  }

  /** https://tc39.es/ecma262/#sec-global-environment-records-initializebinding-n-v */
  * InitializeBinding(N: JSStringValue, V: Value) {
    // 1. Let envRec be the global Environment Record for which the method was invoked.
    const envRec = this;
    // 2. Let DclRec be envRec.[[DeclarativeRecord]].
    const DclRec = envRec.DeclarativeRecord;
    // 3. If DclRec.HasBinding(N) is true, then
    // TODO: remove skipDebugger
    if (skipDebugger(DclRec.HasBinding(N)) === Value.true) {
      // a. Return DclRec.InitializeBinding(N, V).
      return yield* DclRec.InitializeBinding(N, V);
    }
    // 4. Assert: If the binding exists, it must be in the object Environment Record.
    // 5. Let ObjRec be envRec.[[ObjectRecord]].
    const ObjRec = envRec.ObjectRecord;
    // 6. Return ? ObjRec.InitializeBinding(N, V).
    return yield* ObjRec.InitializeBinding(N, V);
  }

  /** https://tc39.es/ecma262/#sec-global-environment-records-setmutablebinding-n-v-s */
  * SetMutableBinding(N: JSStringValue, V: Value, S: BooleanValue): PlainEvaluator {
    // 1. Let envRec be the global Environment Record for which the method was invoked.
    const envRec = this;
    // 2. Let DclRec be envRec.[[DeclarativeRecord]].
    const DclRec = envRec.DeclarativeRecord;
    // 3. If DclRec.HasBinding(N) is true, then
    if ((yield* DclRec.HasBinding(N)) === Value.true) {
      // a. Return DclRec.SetMutableBinding(N, V, S).
      return yield* DclRec.SetMutableBinding(N, V, S);
    }
    // 4. Let ObjRec be envRec.[[ObjectRecord]].
    const ObjRec = envRec.ObjectRecord;
    // 5. Return ? ObjRec.SetMutableBinding(N, V, S).
    Q(yield* ObjRec.SetMutableBinding(N, V, S));
    return undefined;
  }

  /** https://tc39.es/ecma262/#sec-global-environment-records-getbindingvalue-n-s */
  * GetBindingValue(N: JSStringValue, S: BooleanValue): ValueEvaluator {
    // 1. Let envRec be the global Environment Record for which the method was invoked.
    const envRec = this;
    // 2. Let DclRec be envRec.[[DeclarativeRecord]].
    const DclRec = envRec.DeclarativeRecord;
    // 3. If DclRec.HasBinding(N) is true, then
    if ((yield* DclRec.HasBinding(N)) === Value.true) {
      // a. Return DclRec.GetBindingValue(N, S).
      return yield* DclRec.GetBindingValue(N, S);
    }
    // 4. Let ObjRec be envRec.[[ObjectRecord]].
    const ObjRec = envRec.ObjectRecord;
    // 5. Return ObjRec.GetBindingValue(N, S).
    return yield* ObjRec.GetBindingValue(N, S);
  }

  /** https://tc39.es/ecma262/#sec-global-environment-records-deletebinding-n */
  * DeleteBinding(N: JSStringValue): PlainEvaluator<BooleanValue> {
    // 1. Let envRec be the global Environment Record for which the method was invoked.
    const envRec = this;
    // 2. Let DclRec be envRec.[[DeclarativeRecord]].
    const DclRec = this.DeclarativeRecord;
    // 3. Let DclRec be envRec.[[DeclarativeRecord]].
    if ((yield* DclRec.HasBinding(N)) === Value.true) {
      // a. Return DclRec.DeleteBinding(N).
      return Q(yield* DclRec.DeleteBinding(N));
    }
    // 4. Let ObjRec be envRec.[[ObjectRecord]].
    const ObjRec = envRec.ObjectRecord;
    // 5. Let globalObject be the binding object for ObjRec.
    const globalObject = ObjRec.BindingObject;
    // 6. Let existingProp be ? HasOwnProperty(globalObject, N).
    const existingProp = Q(yield* HasOwnProperty(globalObject, N));
    // 7. If existingProp is true, then
    if (existingProp === Value.true) {
      // a. Return ? ObjRec.DeleteBinding(N).
      return Q(yield* ObjRec.DeleteBinding(N));
    }
    // 8. Return true.
    return Value.true;
  }

  /** https://tc39.es/ecma262/#sec-global-environment-records-hasthisbinding */
  HasThisBinding() {
    // Return true.
    return Value.true;
  }

  /** https://tc39.es/ecma262/#sec-global-environment-records-hassuperbinding */
  HasSuperBinding() {
    // 1. Return false.
    return Value.false;
  }

  /** https://tc39.es/ecma262/#sec-global-environment-records-withbaseobject */
  WithBaseObject() {
    // 1. Return undefined.
    return Value.undefined;
  }

  /** https://tc39.es/ecma262/#sec-global-environment-records-getthisbinding */
  GetThisBinding() {
    // 1. Let envRec be the global Environment Record for which the method was invoked.
    const envRec = this;
    // 2. Return envRec.[[GlobalThisValue]].
    return envRec.GlobalThisValue;
  }

  /** https://tc39.es/ecma262/#sec-haslexicaldeclaration */
  * HasLexicalDeclaration(N: JSStringValue) {
    // 1. Let envRec be the global Environment Record for which the method was invoked.
    const envRec = this;
    // 2. Let envRec be the global Environment Record for which the method was invoked.
    const DclRec = envRec.DeclarativeRecord;
    // 3. Let DclRec be envRec.[[DeclarativeRecord]].
    return yield* DclRec.HasBinding(N);
  }

  /** https://tc39.es/ecma262/#sec-hasrestrictedglobalproperty */
  * HasRestrictedGlobalProperty(N: JSStringValue): ValueEvaluator<BooleanValue> {
    // 1. Let envRec be the global Environment Record for which the method was invoked.
    const envRec = this;
    // 2. Let ObjRec be envRec.[[ObjectRecord]].
    const ObjRec = envRec.ObjectRecord;
    // 3. Let globalObject be the binding object for ObjRec.
    const globalObject = ObjRec.BindingObject;
    // 4. Let existingProp be ? globalObject.[[GetOwnProperty]](N).
    const existingProp = Q(yield* globalObject.GetOwnProperty(N));
    // 5. If existingProp is undefined, return false.
    if (existingProp instanceof UndefinedValue) {
      return Value.false;
    }
    // 6. If existingProp.[[Configurable]] is true, return false.
    if (existingProp.Configurable === Value.true) {
      return Value.false;
    }
    // Return true.
    return Value.true;
  }

  /** https://tc39.es/ecma262/#sec-candeclareglobalvar */
  * CanDeclareGlobalVar(N: JSStringValue): ValueEvaluator<BooleanValue> {
    // 1. Let envRec be the global Environment Record for which the method was invoked.
    const envRec = this;
    // 2. Let ObjRec be envRec.[[ObjectRecord]].
    const ObjRec = envRec.ObjectRecord;
    // 3. Let globalObject be the binding object for ObjRec.
    const globalObject = ObjRec.BindingObject;
    // 4. Let hasProperty be ? HasOwnProperty(globalObject, N).
    const hasProperty = Q(yield* HasOwnProperty(globalObject, N));
    // 5. If hasProperty is true, return true.
    if (hasProperty === Value.true) {
      return Value.true;
    }
    // 6. Return ? IsExtensible(globalObject).
    return Q(yield* IsExtensible(globalObject));
  }

  /** https://tc39.es/ecma262/#sec-candeclareglobalfunction */
  * CanDeclareGlobalFunction(N: JSStringValue): ValueEvaluator<BooleanValue> {
    // 1. Let envRec be the global Environment Record for which the method was invoked.
    const envRec = this;
    // 2. Let ObjRec be envRec.[[ObjectRecord]].
    const ObjRec = envRec.ObjectRecord;
    // 3. Let globalObject be the binding object for ObjRec.
    const globalObject = ObjRec.BindingObject;
    // 4. Let existingProp be ? globalObject.[[GetOwnProperty]](N).
    const existingProp = Q(yield* globalObject.GetOwnProperty(N));
    // 5. If existingProp is undefined, return ? IsExtensible(globalObject).
    if (existingProp instanceof UndefinedValue) {
      return Q(yield* IsExtensible(globalObject));
    }
    // 6. If existingProp.[[Configurable]] is true, return true.
    if (existingProp.Configurable === Value.true) {
      return Value.true;
    }
    // 7. If IsDataDescriptor(existingProp) is true and existingProp has attribute values
    //    { [[Writable]]: true, [[Enumerable]]: true }, return true.
    if (IsDataDescriptor(existingProp) === true
      && existingProp.Writable === Value.true
      && existingProp.Enumerable === Value.true) {
      return Value.true;
    }
    // 8. Return false.
    return Value.false;
  }

  /** https://tc39.es/ecma262/#sec-createglobalvarbinding */
  * CreateGlobalVarBinding(N: JSStringValue, D: BooleanValue): PlainEvaluator {
    // 1. Let envRec be the global Environment Record for which the method was invoked.
    const envRec = this;
    // 2. Let ObjRec be envRec.[[ObjectRecord]].
    const ObjRec = envRec.ObjectRecord;
    // 3. Let globalObject be the binding object for ObjRec.
    const globalObject = ObjRec.BindingObject;
    // 4. Let hasProperty be ? HasOwnProperty(globalObject, N).
    const hasProperty = Q(yield* HasOwnProperty(globalObject, N));
    // 5. Let extensible be ? IsExtensible(globalObject).
    const extensible = Q(yield* IsExtensible(globalObject));
    // 6. If hasProperty is false and extensible is true, then
    if (hasProperty === Value.false && extensible === Value.true) {
      // a. Perform ? ObjRec.CreateMutableBinding(N, D).
      Q(yield* ObjRec.CreateMutableBinding(N, D));
      // b. Perform ? ObjRec.InitializeBinding(N, undefined).
      Q(yield* ObjRec.InitializeBinding(N, Value.undefined));
    }
    // return NormalCompletion(empty).
    return NormalCompletion(undefined);
  }

  /** https://tc39.es/ecma262/#sec-createglobalfunctionbinding */
  * CreateGlobalFunctionBinding(N: JSStringValue, V: Value, D: BooleanValue): PlainEvaluator {
    // 1. Let envRec be the global Environment Record for which the method was invoked.
    const envRec = this;
    // 2. Let ObjRec be envRec.[[ObjectRecord]].
    const ObjRec = envRec.ObjectRecord;
    // 3. Let globalObject be the binding object for ObjRec.
    const globalObject = ObjRec.BindingObject;
    // 4. Let existingProp be ? globalObject.[[GetOwnProperty]](N).
    const existingProp = Q(yield* globalObject.GetOwnProperty(N));
    // 5. If existingProp is undefined or existingProp.[[Configurable]] is true, then
    let desc;
    if (existingProp instanceof UndefinedValue || existingProp.Configurable === Value.true) {
      // a. Let desc be the PropertyDescriptor { [[Value]]: V, [[Writable]]: true, [[Enumerable]]: true, [[Configurable]]: D }.
      desc = Descriptor({
        Value: V,
        Writable: Value.true,
        Enumerable: Value.true,
        Configurable: D,
      });
    } else {
      // a. Let desc be the PropertyDescriptor { [[Value]]: V }.
      desc = Descriptor({
        Value: V,
      });
    }
    // 7. Perform ? DefinePropertyOrThrow(globalObject, N, desc).
    Q(yield* DefinePropertyOrThrow(globalObject, N, desc));
    // 8. Record that the binding for N in ObjRec has been initialized.
    // 9. Perform ? Set(globalObject, N, V, false).
    Q(yield* Set(globalObject, N, V, Value.false));
    // 1. Return NormalCompletion(empty).
    return NormalCompletion(undefined);
  }

  override mark(m: GCMarker) {
    // TODO(ts): this function does not call super.mark(). is it a mistake?
    m(this.ObjectRecord);
    m(this.GlobalThisValue);
    m(this.DeclarativeRecord);
  }
}

/** https://tc39.es/ecma262/#sec-module-environment-records */
export class ModuleEnvironmentRecord extends DeclarativeEnvironmentRecord {
  declare readonly bindings: JSStringMap<ModuleEnvironmentBinding>;

  /** https://tc39.es/ecma262/#sec-module-environment-records-getbindingvalue-n-s */
  override* GetBindingValue(N: JSStringValue, S: BooleanValue): ValueEvaluator {
    // 1. Assert: S is true.
    Assert(S === Value.true);
    // 2. Let envRec be the module Environment Record for which the method was invoked.
    const envRec = this;
    // 3. Assert: envRec has a binding for N.
    const binding = envRec.bindings.get(N);
    Assert(binding !== undefined);
    // 4. If the binding for N is an indirect binding, then
    if (binding.indirect === true) {
      // a. Let M and N2 be the indirection values provided when this binding for N was created.
      const [M, N2] = binding.target;
      // b.Let targetEnv be M.[[Environment]].
      const targetEnv = M.Environment;
      // c. If targetEnv is undefined, throw a ReferenceError exception.
      if (!targetEnv) {
        return surroundingAgent.Throw('ReferenceError', 'NotDefined', N);
      }
      // d. Return ? targetEnv.GetBindingValue(N2, true).
      return yield* targetEnv.GetBindingValue(N2, Value.true);
    }
    // 5. If the binding for N in envRec is an uninitialized binding, throw a ReferenceError exception.
    if (binding.initialized === false) {
      return surroundingAgent.Throw('ReferenceError', 'NotInitialized', N);
    }
    // 6. Return the value currently bound to N in envRec.
    return NormalCompletion(binding.value!);
  }

  /** https://tc39.es/ecma262/#sec-module-environment-records-deletebinding-n */
  override DeleteBinding(): never {
    Assert(false, 'This method is never invoked. See #sec-delete-operator-static-semantics-early-errors');
  }

  /** https://tc39.es/ecma262/#sec-module-environment-records-hasthisbinding */
  override HasThisBinding() {
    // Return true.
    return Value.true;
  }

  /** https://tc39.es/ecma262/#sec-module-environment-records-getthisbinding */
  GetThisBinding() {
    // Return undefined.
    return Value.undefined;
  }

  /** https://tc39.es/ecma262/#sec-createimportbinding */
  CreateImportBinding(N: JSStringValue, M: AbstractModuleRecord, N2: JSStringValue) {
    // 1. Let envRec be the module Environment Record for which the method was invoked.
    const envRec = this;
    // 2. Assert: envRec does not already have a binding for N.
    Assert(skipDebugger(envRec.HasBinding(N)) === Value.false);
    // 3. Assert: M is a Module Record.
    Assert(M instanceof AbstractModuleRecord);
    // 4. Assert: When M.[[Environment]] is instantiated it will have a direct binding for N2.
    // 5. Create an immutable indirect binding in envRec for N that references M and N2 as its target binding and record that the binding is initialized.
    envRec.bindings.set(N, {
      indirect: true,
      target: [M, N2],
      initialized: true,
      mark(m: GCMarker) {
        m(this.target[0]);
        m(this.target[1]);
      },
    });
    // 6. Return NormalCompletion(empty).
    return NormalCompletion(undefined);
  }
}

/** https://tc39.es/ecma262/#sec-getidentifierreference */
export function* GetIdentifierReference(env: EnvironmentRecord | NullValue, name: JSStringValue, strict: BooleanValue): PlainEvaluator<ReferenceRecord> {
  // 1. If lex is the value null, then
  if (env instanceof NullValue) {
    // a. Return the Reference Record { [[Base]]: unresolvable, [[ReferencedName]]: name, [[Strict]]: strict, [[ThisValue]]: empty }.
    return NormalCompletion(new ReferenceRecord({
      Base: 'unresolvable',
      ReferencedName: name,
      Strict: strict,
      ThisValue: undefined,
    }));
  }
  // 2. Let exists be ? envRec.HasBinding(name).
  const exists = Q(yield* env.HasBinding(name));
  // 3. If exists is true, then
  if (exists === Value.true) {
    // a. Return the Reference Record { [[Base]]: env, [[ReferencedName]]: name, [[Strict]]: strict, [[ThisValue]]: empty }.
    return NormalCompletion(new ReferenceRecord({
      Base: env,
      ReferencedName: name,
      Strict: strict,
      ThisValue: undefined,
    }));
  } else {
    // a. Let outer be env.[[OuterEnv]].
    const outer = env.OuterEnv;
    // b. Return ? GetIdentifierReference(outer, name, strict).
    return yield* GetIdentifierReference(outer, name, strict);
  }
}

export class PrivateEnvironmentRecord {
  readonly OuterPrivateEnvironment: PrivateEnvironmentRecord | NullValue;

  readonly Names: PrivateName[] = [];

  /** https://tc39.es/ecma262/#sec-newprivateenvironment */
  constructor(outerEnv: PrivateEnvironmentRecord | NullValue) {
    this.OuterPrivateEnvironment = outerEnv;
  }

  mark(m: GCMarker) {
    this.Names.forEach((name) => {
      m(name);
    });
  }
}

export type EnvironmentRecordWithThisBinding = FunctionEnvironmentRecord | GlobalEnvironmentRecord | ModuleEnvironmentRecord;
