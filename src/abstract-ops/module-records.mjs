import { surroundingAgent, HostResolveImportedModule } from '../engine.mjs';
import {
  AbstractModuleRecord,
  CyclicModuleRecord,
  SyntheticModuleRecord,
  ResolvedBindingRecord,
} from '../modules.mjs';
import { Value } from '../value.mjs';
import {
  Q, X, NormalCompletion, ThrowCompletion,
} from '../completion.mjs';
import {
  Assert,
  ModuleNamespaceCreate,
  NewPromiseCapability,
  PerformPromiseThen,
  CreateBuiltinFunction,
  Call,
} from './all.mjs';

// 15.2.1.16.1.1 #sec-InnerModuleLinking
export function InnerModuleLinking(module, stack, index) {
  if (!(module instanceof CyclicModuleRecord)) {
    Q(module.Link());
    return index;
  }
  if (module.Status === 'linking' || module.Status === 'linked' || module.Status === 'evaluated') {
    return index;
  }
  Assert(module.Status === 'unlinked');
  module.Status = 'linking';
  module.DFSIndex = index;
  module.DFSAncestorIndex = index;
  index += 1;
  stack.push(module);
  for (const required of module.RequestedModules) {
    const requiredModule = Q(HostResolveImportedModule(module, required));
    index = Q(InnerModuleLinking(requiredModule, stack, index));
    if (requiredModule instanceof CyclicModuleRecord) {
      Assert(requiredModule.Status === 'linking' || requiredModule.Status === 'linked' || requiredModule.Status === 'evaluated');
      Assert((requiredModule.Status === 'linking') === stack.includes(requiredModule));
      if (requiredModule.Status === 'linking') {
        module.DFSAncestorIndex = Math.min(module.DFSAncestorIndex, requiredModule.DFSAncestorIndex);
      }
    }
  }
  Q(module.InitializeEnvironment());
  Assert(stack.indexOf(module) === stack.lastIndexOf(module));
  Assert(module.DFSAncestorIndex <= module.DFSIndex);
  if (module.DFSAncestorIndex === module.DFSIndex) {
    let done = false;
    while (done === false) {
      const requiredModule = stack.pop();
      Assert(requiredModule instanceof CyclicModuleRecord);
      requiredModule.Status = 'linked';
      if (requiredModule === module) {
        done = true;
      }
    }
  }
  return index;
}

// 15.2.1.16.2.1 #sec-innermoduleevaluation
export function InnerModuleEvaluation(module, stack, index) {
  if (!(module instanceof CyclicModuleRecord)) {
    Q(module.Evaluate());
    return index;
  }
  if (module.Status === 'evaluated') {
    if (module.EvaluationError === Value.undefined) {
      return index;
    } else {
      return module.EvaluationError;
    }
  }
  if (module.Status === 'evaluating') {
    return index;
  }
  Assert(module.Status === 'linked');
  module.Status = 'evaluating';
  module.DFSIndex = index;
  module.DFSAncestorIndex = index;
  module.PendingAsyncDependencies = 0;
  module.AsyncParentModules = [];
  index += 1;
  stack.push(module);
  for (const required of module.RequestedModules) {
    let requiredModule = X(HostResolveImportedModule(module, required));
    index = Q(InnerModuleEvaluation(requiredModule, stack, index));
    if (requiredModule instanceof CyclicModuleRecord) {
      Assert(requiredModule.Status === 'evaluating' || requiredModule.Status === 'evaluated');
      if (stack.includes(requiredModule)) {
        Assert(requiredModule.Status === 'evaluating');
      }
      if (requiredModule.Status === 'evaluating') {
        module.DFSAncestorIndex = Math.min(module.DFSAncestorIndex, requiredModule.DFSAncestorIndex);
      } else {
        requiredModule = GetAsyncCycleRoot(requiredModule);
        Assert(requiredModule.Status === 'evaluated');
        if (requiredModule.EvaluationError !== Value.undefined) {
          return module.EvaluationError;
        }
      }
      if (requiredModule.AsyncEvaluating === Value.true) {
        module.PendingAsyncDependencies += 1;
        requiredModule.AsyncParentModules.push(module);
      }
    }
  }
  if (module.PendingAsyncDependencies > 0) {
    module.AsyncEvaluating = Value.true;
  } else if (module.Async === Value.true) {
    X(ExecuteAsyncModule(module));
  } else {
    Q(module.ExecuteModule());
  }
  Assert(stack.indexOf(module) === stack.lastIndexOf(module));
  Assert(module.DFSAncestorIndex <= module.DFSIndex);
  if (module.DFSAncestorIndex === module.DFSIndex) {
    let done = false;
    while (done === false) {
      const requiredModule = stack.pop();
      Assert(requiredModule instanceof CyclicModuleRecord);
      requiredModule.Status = 'evaluated';
      if (requiredModule === module) {
        done = true;
      }
    }
  }
  return index;
}

// #sec-execute-async-module
function ExecuteAsyncModule(module) {
  // 1. Assert: module.[[Status]] is evaluating or evaluated.
  Assert(module.Status === 'evaluating' || module.Status === 'evaluated');
  // 2. Assert: module.[[Async]] is true.
  Assert(module.Async === Value.true);
  // 3. Set module.[[AsyncEvaluating]] to true.
  module.AsyncEvaluating = Value.true;
  // 4. Let capability be ! NewPromiseCapability(%Promise%).
  const capability = X(NewPromiseCapability(surroundingAgent.intrinsic('%Promise%')));
  // 5. Let fulfilledClosure be a new Abstract Closure with no parameters that captures module and performs the following steps when called:
  const fulfilledClosure = () => {
    // a. Perform ! AsyncModuleExecutionFulfilled(module).
    X(AsyncModuleExecutionFulfilled(module));
    // b. Return undefined.
    return Value.undefined;
  };
  // 6. Let onFulfilled be ! CreateBuiltinFunction(fulfilledClosure, 0, "", « »).
  const onFulfilled = CreateBuiltinFunction(fulfilledClosure, 0, new Value(''), ['Module']);
  // 7. Let rejectedClosure be a new Abstract Closure with parameters (error) that captures module and performs the following steps when called:
  const rejectedClosure = ([error = Value.undefined]) => {
    // a. Perform ! AsyncModuleExecutionRejected(module, error).
    X(AsyncModuleExecutionRejected(module, error));
    // b. Return undefined.
    return Value.undefined;
  };
  // 8. Let onRejected be ! CreateBuiltinFunction(rejectedClosure, 0, "", « »).
  const onRejected = CreateBuiltinFunction(rejectedClosure, 0, new Value(''), ['Module']);
  // 9. Perform ! PerformPromiseThen(capability.[[Promise]], onFulfilled, onRejected).
  X(PerformPromiseThen(capability.Promise, onFulfilled, onRejected));
  // 10. Perform ! module.ExecuteModule(capability).
  X(module.ExecuteModule(capability));
  // 11. Return.
  return Value.undefined;
}

// #sec-getcycleroot
export function GetAsyncCycleRoot(module) {
  Assert(module.Status === 'evaluated');
  if (module.AsyncParentModules.length === 0) {
    return module;
  }
  while (module.DFSIndex > module.DFSAncestorIndex) {
    Assert(module.AsyncParentModules.length > 0);
    const nextCycleModule = module.AsyncParentModules[0];
    Assert(nextCycleModule.DFSAncestorIndex === module.DFSAncestorIndex);
    module = nextCycleModule;
  }
  Assert(module.DFSIndex === module.DFSAncestorIndex);
  return module;
}

// #sec-asyncmodulexecutionfulfilled
function AsyncModuleExecutionFulfilled(module) {
  Assert(module.Status === 'evaluated');
  if (module.AsyncEvaluating === Value.false) {
    Assert(module.EvaluationError !== Value.undefined);
    return Value.undefined;
  }
  Assert(module.EvaluationError === Value.undefined);
  module.AsyncEvaluating = Value.false;
  for (const m of module.AsyncParentModules) {
    if (module.DFSIndex !== module.DFSAncestorIndex) {
      Assert(m.DFSAncestorIndex === module.DFSAncestorIndex);
    }
    m.PendingAsyncDependencies -= 1;
    if (m.PendingAsyncDependencies === 0 && m.EvaluationError === Value.undefined) {
      Assert(m.AsyncEvaluating === Value.true);
      const cycleRoot = X(GetAsyncCycleRoot(m));
      if (cycleRoot.EvaluationError !== Value.undefined) {
        return Value.undefined;
      }
      if (m.Async === Value.true) {
        X(ExecuteAsyncModule(m));
      } else {
        const result = m.ExecuteModule();
        if (result instanceof NormalCompletion) {
          X(AsyncModuleExecutionFulfilled(m));
        } else {
          X(AsyncModuleExecutionRejected(m, result.Value));
        }
      }
    }
  }
  if (module.TopLevelCapability !== Value.undefined) {
    Assert(module.DFSIndex === module.DFSAncestorIndex);
    X(Call(module.TopLevelCapability.Resolve, Value.undefined, [Value.undefined]));
  }
  return Value.undefined;
}

// #sec-AsyncModuleExecutionRejected
function AsyncModuleExecutionRejected(module, error) {
  Assert(module.Status === 'evaluated');
  if (module.AsyncEvaluating === Value.false) {
    Assert(module.EvaluationError !== Value.undefined);
    return Value.undefined;
  }
  Assert(module.EvaluationError === Value.undefined);
  module.EvaluationError = ThrowCompletion(error);
  module.AsyncEvaluating = Value.false;
  for (const m of module.AsyncParentModules) {
    if (module.DFSIndex !== module.DFSAncestorIndex) {
      Assert(m.DFSAncestorIndex === module.DFSAncestorIndex);
    }
    X(AsyncModuleExecutionRejected(m, error));
  }
  if (module.TopLevelCapability !== Value.undefined) {
    Assert(module.DFSIndex === module.DFSAncestorIndex);
    X(Call(module.TopLevelCapability.Reject, Value.undefined, [error]));
  }
  return Value.undefined;
}

// 15.2.1.21 #sec-getmodulenamespace
export function GetModuleNamespace(module) {
  Assert(module instanceof AbstractModuleRecord);
  if (module instanceof CyclicModuleRecord) {
    Assert(module.Status !== 'unlinked');
  }
  let namespace = module.Namespace;
  if (namespace === Value.undefined) {
    const exportedNames = Q(module.GetExportedNames());
    const unambiguousNames = [];
    for (const name of exportedNames) {
      const resolution = Q(module.ResolveExport(name));
      if (resolution instanceof ResolvedBindingRecord) {
        unambiguousNames.push(name);
      }
    }
    namespace = ModuleNamespaceCreate(module, unambiguousNames);
  }
  return namespace;
}

export function CreateSyntheticModule(exportNames, evaluationSteps, realm, hostDefined) {
  // 1. Return Synthetic Module Record {
  //      [[Realm]]: realm,
  //      [[Environment]]: undefined,
  //      [[Namespace]]: undefined,
  //      [[HostDefined]]: hostDefined,
  //      [[ExportNames]]: exportNames,
  //      [[EvaluationSteps]]: evaluationSteps
  //    }.
  return new SyntheticModuleRecord({
    Realm: realm,
    Environment: Value.undefined,
    Namespace: Value.undefined,
    HostDefined: hostDefined,
    ExportNames: exportNames,
    EvaluationSteps: evaluationSteps,
  });
}

// #sec-create-default-export-synthetic-module
export function CreateDefaultExportSyntheticModule(defaultExport, realm, hostDefined) {
  // 1. Let closure be the a Abstract Closure with parameters (module) that captures defaultExport and performs the following steps when called:
  const closure = (module) => { // eslint-disable-line arrow-body-style
    // a. Return ? module.SetSyntheticExport("default", defaultExport).
    return Q(module.SetSyntheticExport(new Value('default'), defaultExport));
  };
  // 2. Return CreateSyntheticModule(« "default" », closure, realm)
  return CreateSyntheticModule([new Value('default')], closure, realm, hostDefined);
}
