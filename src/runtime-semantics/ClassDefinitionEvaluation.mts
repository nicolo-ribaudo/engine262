import { surroundingAgent } from '../host-defined/engine.mts';
import {
  Value, NullValue, ObjectValue, PrivateName,
  BooleanValue,
  JSStringValue,
  type Arguments,
  type FunctionCallContext,
  UndefinedValue,
  type PropertyKeyValue,
} from '../value.mts';
import { Evaluate } from '../evaluator.mts';
import {
  Assert,
  Call,
  Construct,
  CreateBuiltinFunction,
  Get,
  GetValue,
  IsConstructor,
  MakeConstructor,
  MakeClassConstructor,
  SetFunctionName,
  CreateMethodProperty,
  OrdinaryObjectCreate,
  OrdinaryCreateFromConstructor,
  PrivateMethodOrAccessorAdd,
  InitializeInstanceElements,
  DefineField,
  type ECMAScriptFunctionObject,
} from '../abstract-ops/all.mts';
import {
  IsStatic,
  ConstructorMethod,
  NonConstructorElements,
  PrivateBoundIdentifiers,
} from '../static-semantics/all.mts';
import {
  DeclarativeEnvironmentRecord,
  PrivateEnvironmentRecord,
} from '../environment.mts';
import {
  Q, X,
  AbruptCompletion,
} from '../completion.mts';
import { __ts_cast__, OutOfRange, type Mutable } from '../helpers.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import {
  DefineMethod,
  MethodDefinitionEvaluation,
  ClassFieldDefinitionEvaluation,
  PrivateElementRecord,
  ClassFieldDefinitionRecord,
  ClassStaticBlockDefinitionEvaluation,
  ClassStaticBlockDefinitionRecord,
} from './all.mts';

function* ClassElementEvaluation(node: ParseNode.MethodDefinition | ParseNode.GeneratorMethod | ParseNode.AsyncMethod | ParseNode.AsyncGeneratorMethod | ParseNode.FieldDefinition | ParseNode.ClassStaticBlock, object: ObjectValue, enumerable: BooleanValue) {
  switch (node.type) {
    case 'MethodDefinition':
    case 'GeneratorMethod':
    case 'AsyncMethod':
    case 'AsyncGeneratorMethod':
      return yield* MethodDefinitionEvaluation(node, object, enumerable);
    case 'FieldDefinition':
      return yield* ClassFieldDefinitionEvaluation(node, object);
    case 'ClassStaticBlock':
      return ClassStaticBlockDefinitionEvaluation(node, object);
    default:
      throw new OutOfRange('ClassElementEvaluation', node);
  }
}

// ClassTail : ClassHeritage? `{` ClassBody? `}`
export function* ClassDefinitionEvaluation(ClassTail: ParseNode.ClassTail, classBinding: JSStringValue | UndefinedValue, className: PropertyKeyValue | PrivateName) {
  const { ClassHeritage, ClassBody } = ClassTail;
  // 1. Let env be the LexicalEnvironment of the running execution context.
  const env = surroundingAgent.runningExecutionContext.LexicalEnvironment;
  // 2. Let classScope be NewDeclarativeEnvironment(env).
  const classScope = new DeclarativeEnvironmentRecord(env);
  // 3. If classBinding is not undefined, then
  if (!(classBinding instanceof UndefinedValue)) {
    // a. Perform classScopeEnv.CreateImmutableBinding(classBinding, true).
    classScope.CreateImmutableBinding(classBinding, Value.true);
  }
  // 4. Let outerPrivateEnvironment be the running execution context's PrivateEnvironment.
  const outerPrivateEnvironment = surroundingAgent.runningExecutionContext.PrivateEnvironment;
  // 5. Let classPrivateEnvironment be NewPrivateEnvironment(outerPrivateEnvironment).
  const classPrivateEnvironment = new PrivateEnvironmentRecord(outerPrivateEnvironment);
  // 6. If ClassBody is present, then
  if (ClassBody) {
    // a. For each String dn of the PrivateBoundIdentifiers of ClassBody, do
    for (const dn of PrivateBoundIdentifiers(ClassBody)) {
      // i. If classPrivateEnvironment.[[Names]] contains a Private Name whose [[Description]] is dn, then
      const existing = classPrivateEnvironment.Names.find((n) => n.Description.stringValue() === dn.stringValue());
      if (existing) {
        // 1. Assert: This is only possible for getter/setter pairs.
      } else { // ii. Else,
        // 1. Let name be a new Private Name whose [[Description]] value is dn.
        const name = new PrivateName(dn);
        // 2. Append name to classPrivateEnvironment.[[Names]].
        classPrivateEnvironment.Names.push(name);
      }
    }
  }
  let protoParent;
  let constructorParent: ObjectValue;
  // 7. If ClassHeritage is not present, then
  if (!ClassHeritage) {
    // a. Let protoParent be %Object.prototype%.
    protoParent = surroundingAgent.intrinsic('%Object.prototype%');
    // b. Let constructorParent be %Function.prototype%.
    constructorParent = surroundingAgent.intrinsic('%Function.prototype%');
  } else { // 8. Else,
    // a. Set the running execution context's LexicalEnvironment to classScope.
    surroundingAgent.runningExecutionContext.LexicalEnvironment = classScope;
    // b. Let superclassRef be the result of evaluating ClassHeritage.
    const superclassRef = Q(yield* Evaluate(ClassHeritage));
    // c. Set the running execution context's LexicalEnvironment to env.
    surroundingAgent.runningExecutionContext.LexicalEnvironment = env;
    // d. Let superclass be ? GetValue(superclassRef).
    const superclass = Q(yield* GetValue(superclassRef));
    // e. If superclass is null, then
    if (superclass instanceof NullValue) {
      // i. Let protoParent be null.
      protoParent = Value.null;
      // ii. Let constructorParent be %Function.prototype%.
      constructorParent = surroundingAgent.intrinsic('%Function.prototype%');
    } else if (!IsConstructor(superclass)) {
      // f. Else if IsConstructor(superclass) is false, throw a TypeError exception.
      return surroundingAgent.Throw('TypeError', 'NotAConstructor', superclass);
    } else { // g. Else,
      // i. Let protoParent be ? Get(superclass, "prototype").
      protoParent = Q(yield* Get(superclass as ObjectValue, Value('prototype')));
      // ii. If Type(protoParent) is neither Object nor Null, throw a TypeError exception.
      if (!(protoParent instanceof ObjectValue) && !(protoParent instanceof NullValue)) {
        return surroundingAgent.Throw('TypeError', 'ObjectPrototypeType');
      }
      // iii. Let constructorParent be superclass.
      constructorParent = superclass as ObjectValue;
    }
  }
  // 9. Let proto be OrdinaryObjectCreate(protoParent).
  const proto = OrdinaryObjectCreate(protoParent);
  let constructor;
  // 10. If ClassBody is not present, let constructor be empty.
  if (!ClassBody) {
    constructor = undefined;
  } else { // 11. Else, let constructor be ConstructorMethod of ClassBody.
    constructor = ConstructorMethod(ClassBody);
  }
  // 12. Set the running execution context's LexicalEnvironment to classScope.
  surroundingAgent.runningExecutionContext.LexicalEnvironment = classScope;
  // 13. Set the running execution context's PrivateEnvironment to classPrivateEnvironment.
  surroundingAgent.runningExecutionContext.PrivateEnvironment = classPrivateEnvironment;
  let F;
  // 14. If constructor is empty, then
  if (constructor === undefined) {
    // a. Let defaultConstructor be a new Abstract Closure with no parameters that captures nothing and performs the following steps when called:
    const defaultConstructor = function* defaultConstructor(args: Arguments, { NewTarget }: FunctionCallContext) {
      // i. Let args be the List of arguments that was passed to this function by [[Call]] or [[Construct]].
      // ii. If NewTarget is undefined, throw a TypeError exception.
      if (NewTarget instanceof UndefinedValue) {
        return surroundingAgent.Throw('TypeError', 'ConstructorNonCallable', surroundingAgent.activeFunctionObject);
      }
      // iii. Let F be the active function object.
      const F = surroundingAgent.activeFunctionObject as ECMAScriptFunctionObject; // eslint-disable-line no-shadow
      let result;
      // iv. If F.[[ConstructorKind]] is derived, then
      if (F.ConstructorKind === 'derived') {
        // 1. NOTE: This branch behaves similarly to `constructor(...args) { super(...args); }`. The most
        //    notable distinction is that while the aforementioned ECMAScript source text observably calls
        //    the @@iterator method on `%Array.prototype%`, a Default Constructor Function does not.
        // 2. Let func be ! F.[[GetPrototypeOf]]().
        const func = X(yield* F.GetPrototypeOf());
        // 3. If IsConstructor(func) is false, throw a TypeError exception.
        if (!IsConstructor(func)) {
          return surroundingAgent.Throw('TypeError', 'NotAConstructor', func);
        }
        // 4. Let result be ? Construct(func, args, NewTarget).
        result = Q(yield* Construct(func, args, NewTarget));
      } else { // v. Else,
        // 1. NOTE: This branch behaves similarly to `constructor() {}`.
        // 2. Let result be ? OrdinaryCreateFromConstructor(NewTarget, "%Object.prototype%").
        result = Q(yield* OrdinaryCreateFromConstructor(NewTarget, '%Object.prototype%'));
      }
      Q(yield* InitializeInstanceElements(result, F));
      return result;
    };
    // b. ! CreateBuiltinFunction(defaultConstructor, 0, className, « [[ConstructorKind]], [[SourceText]] », the current Realm Record, constructorParent).
    F = X(CreateBuiltinFunction(defaultConstructor, 0, className, ['ConstructorKind', 'SourceText'], undefined, constructorParent, undefined, Value.true));
  } else { // 15. Else,
    // a. Let constructorInfo be ! DefineMethod of constructor with arguments proto and constructorParent.
    const constructorInfo = X(yield* DefineMethod(constructor, proto, constructorParent));
    // b. Let F be constructorInfo.[[Closure]].
    F = constructorInfo.Closure;
    // c. Perform SetFunctionName(F, className).
    SetFunctionName(F, className);
  }
  __ts_cast__<Mutable<ECMAScriptFunctionObject>>(F);
  // 16. Perform MakeConstructor(F, false, proto).
  MakeConstructor(F, Value.false, proto);
  // https://github.com/tc39/ecma262/pull/3212/
  // 17. Perform MakeClassConstructor(F).
  MakeClassConstructor(F);
  // 18. If ClassHeritage is present, set F.[[ConstructorKind]] to derived.
  if (ClassHeritage) {
    F.ConstructorKind = 'derived';
  }
  // 19. Perform CreateMethodProperty(proto, "constructor", F).
  X(CreateMethodProperty(proto, Value('constructor'), F));
  // 20. If ClassBody is not present, let elements be a new empty List.
  let elements: ParseNode.ClassElement[];
  if (!ClassBody) {
    elements = [];
  } else { // 20. Else, let elements be NonConstructorElements of ClassBody.
    elements = NonConstructorElements(ClassBody);
  }
  // 21. Let instancePrivateMethods be a new empty List.
  const instancePrivateMethods: never[] = [];
  // 22. Let staticPrivateMethods be a new empty List.
  const staticPrivateMethods: never[] = [];
  // 23. Let instanceFields be a new empty List.
  const instanceFields: ClassFieldDefinitionRecord[] = [];
  // 24. Let staticElements be a new empty List.
  const staticElements: (ClassFieldDefinitionRecord | ClassStaticBlockDefinitionRecord)[] = [];
  // 25. For each ClassElement e of elements, do
  for (const e of elements) {
    let field;
    // a. If IsStatic of e is false, then
    if (IsStatic(e) === false) {
      // i. Let field be ClassElementEvaluation of e with arguments proto and false.
      field = (yield* ClassElementEvaluation(e, proto, Value.false))!;
    } else { // b. Else,
      // i. Let field be ClassElementEvaluation of e with arguments F and false.
      field = (yield* ClassElementEvaluation(e, F, Value.false))!;
    }
    // c. If field is an abrupt completion, then
    if (field instanceof AbruptCompletion) {
      // i. Set the running execution context's LexicalEnvironment to env.
      surroundingAgent.runningExecutionContext.LexicalEnvironment = env;
      // ii. Set the running execution context's PrivateEnvironment to outerPrivateEnvironment.
      surroundingAgent.runningExecutionContext.PrivateEnvironment = outerPrivateEnvironment;
      // iii. Return Completion(field).
      return field;
    }
    // d. Set field to field.[[Value]].
    Q(field);
    // e. If field is a PrivateElement, then
    if (field instanceof PrivateElementRecord) {
      // i. Assert: field.[[Kind]] is either method or accessor.
      Assert(field.Kind === 'method' || field.Kind === 'accessor');
      // ii. If IsStatic of e is false, let container be instancePrivateMethods.
      let container: PrivateElementRecord[];
      if (IsStatic(e) === false) {
        container = instancePrivateMethods;
      } else { // iii. Else, let container be staticPrivateMethods.
        container = staticPrivateMethods;
      }
      // iv. If container contains a PrivateElement whose [[Key]] is field.[[Key]], then
      const index = container.findIndex((el) => el.Key === field.Key);
      if (index >= 0) {
        // 1. Let existing be that PrivateElement.
        const existing = container[index];
        // 2. Assert: field.[[Kind]] and existing.[[Kind]] are both accessor.
        Assert(field.Kind === 'accessor' && existing.Kind === 'accessor');
        // 3. If field.[[Get]] is undefined, then
        let combined;
        if (field.Get === Value.undefined) {
          combined = new PrivateElementRecord({
            Key: field.Key,
            Kind: 'accessor',
            Get: existing.Get,
            Set: field.Set,
          });
        } else { // 4. Else
          combined = new PrivateElementRecord({
            Key: field.Key,
            Kind: 'accessor',
            Get: field.Get,
            Set: existing.Set,
          });
        }
        // 5. Replace existing in container with combined.
        container[index] = combined;
      } else { // v. Else,
        // 1. Append field to container.
        container.push(field);
      }
    } else if (field instanceof ClassFieldDefinitionRecord) { // f. Else if field is a ClassFieldDefinition Record, then
      // i. If IsStatic of e is false, append field to instanceFields.
      if (IsStatic(e) === false) {
        instanceFields.push(field);
      } else { // ii. Else, append field to staticElements.
        staticElements.push(field);
      }
    } else if (field instanceof ClassStaticBlockDefinitionRecord) { // g. Else if element is a ClassStaticBlockDefinition Record, then
      // i. Append element to staticElements.
      staticElements.push(field);
    }
  }
  // 26. Set the running execution context's LexicalEnvironment to env.
  surroundingAgent.runningExecutionContext.LexicalEnvironment = env;
  // 27. If classBinding is not undefined, then
  if (!(classBinding instanceof UndefinedValue)) {
    // a. Perform classScope.InitializeBinding(classBinding, F).
    yield* classScope.InitializeBinding(classBinding, F);
  }
  // 28. Set F.[[PrivateMethods]] to instancePrivateMethods.
  F.PrivateMethods = instancePrivateMethods;
  // 29. Set F.[[Fields]] to instanceFields.
  F.Fields = instanceFields;
  // 30. For each PrivateElement method of staticPrivateMethods, do
  for (const method of staticPrivateMethods) {
    // a. Perform ! PrivateMethodOrAccessorAdd(method, F).
    X(PrivateMethodOrAccessorAdd(method, F));
  }
  // 31. For each element elementRecord of staticElements, do
  for (const elementRecord of staticElements) {
    let result;
    // a. If elementRecord is a ClassFieldDefinition Record, then
    if (elementRecord instanceof ClassFieldDefinitionRecord) {
      // a. Let result be DefineField(F, elementRecord).
      result = yield* DefineField(F, elementRecord);
    } else { // b. Else,
      // i. Assert: elementRecord is a ClassStaticBlockDefinition Record.
      Assert(elementRecord instanceof ClassStaticBlockDefinitionRecord);
      // ii. Let result be Completion(Call(elementRecord.[[BodyFunction]], F)).
      result = yield* Call(elementRecord.BodyFunction, F);
    }
    // c. If result is an abrupt completion, then
    if (result instanceof AbruptCompletion) {
      // i. Set the running execution context's PrivateEnvironment to outerPrivateEnvironment.
      surroundingAgent.runningExecutionContext.PrivateEnvironment = outerPrivateEnvironment;
      // ii. Return result.
      return result;
    }
  }
  // 32. Set the running execution context's PrivateEnvironment to outerPrivateEnvironment.
  surroundingAgent.runningExecutionContext.PrivateEnvironment = outerPrivateEnvironment;
  // 33. Return F.
  return F;
}
