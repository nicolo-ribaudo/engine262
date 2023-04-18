import { surroundingAgent, HostLoadImportedModule } from '../engine.mjs';
import {
  CyclicModuleRecord,
  SyntheticModuleRecord,
  ResolvedBindingRecord,
} from '../modules.mjs';
import { Value } from '../value.mjs';
import {
  Q, X, NormalCompletion, ThrowCompletion, AbruptCompletion,
} from '../completion.mjs';
import {
  Assert,
  ModuleNamespaceCreate,
  NewPromiseCapability,
  PerformPromiseThen,
  CreateBuiltinFunction,
  Call,
  ContinueDynamicImport,
} from './all.mjs';

/** https://tc39.es/ecma262/#graphloadingstate-record */
export class GraphLoadingState {
  constructor({ PromiseCapability, HostDefined }) {
    this.PromiseCapability = PromiseCapability;
    this.HostDefined = HostDefined;
    this.IsLoading = true;
    this.Visited = new Set();
    this.PendingModules = 1;
  }
}

/** http://tc39.es/ecma262/#sec-InnerModuleLoading */
export function InnerModuleLoading(state, module) {
  // 1. Assert: state.[[IsLoading]] is true.
  Assert(state.IsLoading === true);

  // 2. If module is a Cyclic Module Record, module.[[Status]] is new, and state.[[Visited]] does not contain module, then
  if (module instanceof CyclicModuleRecord && module.Status === 'new' && !state.Visited.has(module)) {
    // a. Append module to state.[[Visited]].
    state.Visited.add(module);
    // b. Let requestedModulesCount be the number of elements in module.[[RequestedModules]].
    const requestedModulesCout = module.RequestedModules.length;
    // c. Set state.[[PendingModulesCount]] to state.[[PendingModulesCount]] + requestedModulesCount.
    state.PendingModules += requestedModulesCout;
    // d. For each String required of module.[[RequestedModules]], do
    for (const { Specifier: required } of module.RequestedModules) {
      // i. If module.[[LoadedModules]] contains a Record whose [[Specifier]] is required, then
      //    1. Let record be that Record.
      const record = getRecordWithSpecifier(module.LoadedModules, required);
      if (record !== undefined) {
        // 2. Perform InnerModuleLoading(state, record.[[Module]]).
        ContinueModuleLoading(state, NormalCompletion(record.Module));
      // ii. Else,
      } else {
        // 1. Perform HostLoadImportedModule(module, required, state.[[HostDefined]], state).
        HostLoadImportedModule(module, required, state.HostDefined, state);
      }

      // iii. If state.[[IsLoading]] is false, return unused.
      if (state.IsLoading === false) {
        return;
      }
    }
  }

  // 3. Assert: state.[[PendingModulesCount]] ≥ 1.
  Assert(state.PendingModules >= 1);
  // 4. Set state.[[PendingModulesCount]] to state.[[PendingModulesCount]] - 1.
  state.PendingModules -= 1;
  // 5. If state.[[PendingModulesCount]] = 0, then
  if (state.PendingModules === 0) {
    // a. Set state.[[IsLoading]] to false.
    state.IsLoading = false;
    // b. For each Cyclic Module Record loaded of state.[[Visited]], do
    for (const loaded of state.Visited) {
      // i. If loaded.[[Status]] is new, set loaded.[[Status]] to unlinked.
      if (loaded.Status === 'new') {
        loaded.Status = 'unlinked';
      }
    }
    // c. Perform ! Call(state.[[PromiseCapability]].[[Resolve]], undefined, « undefined »).
    X(Call(state.PromiseCapability.Resolve, Value.undefined, [Value.undefined]));
  }

  // 6. Return unused.
}

/** http://tc39.es/ecma262/#sec-ContinueModuleLoading */
export function ContinueModuleLoading(state, result) {
  // 1. If state.[[IsLoading]] is false, return unused.
  if (state.IsLoading === false) {
    return;
  }
  // 2. If moduleCompletion is a normal completion, then
  if (result instanceof NormalCompletion) {
    // a. Perform InnerModuleLoading(state, moduleCompletion.[[Value]]).
    InnerModuleLoading(state, result.Value);
  // 3. Else,
  } else {
    // a. Set state.[[IsLoading]] to false.
    state.IsLoading = false;
    // b. Perform ! Call(state.[[PromiseCapability]].[[Reject]], undefined, « moduleCompletion.[[Value]] »).
    X(Call(state.PromiseCapability.Reject, Value.undefined, [result.Value]));
  }

  // 4. Return unused.
}

/** http://tc39.es/ecma262/#sec-InnerModuleLinking */
export function InnerModuleLinking(module, stack, index) {
  if (!(module instanceof CyclicModuleRecord)) {
    Q(module.Link());
    return index;
  }
  if (module.Status === 'linking' || module.Status === 'linked' || module.Status === 'async-subgraphs-searching-async' || module.Status === 'async-subgraphs-evaluated' || module.Status === 'evaluating-async' || module.Status === 'evaluated') {
    return index;
  }
  Assert(module.Status === 'unlinked');
  module.Status = 'linking';
  module.DFSIndex = index;
  module.DFSAncestorIndex = index;
  index += 1;
  stack.push(module);
  for (const { Specifier: required } of module.RequestedModules) {
    const requiredModule = GetImportedModule(module, required);
    index = Q(InnerModuleLinking(requiredModule, stack, index));
    if (requiredModule instanceof CyclicModuleRecord) {
      Assert(requiredModule.Status === 'linking' || requiredModule.Status === 'linked' || requiredModule.Status === 'async-subgraphs-searching-async' || requiredModule.Status === 'async-subgraphs-evaluated' || requiredModule.Status === 'evaluating-async' || requiredModule.Status === 'evaluated');
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

/** http://tc39.es/ecma262/#sec-innermoduleevaluation */
export function InnerModuleEvaluation(module, stack, index) {
  if (!(module instanceof CyclicModuleRecord)) {
    Q(module.Evaluate());
    return index;
  }
  if (module.Status === 'evaluating-async' || module.Status === 'evaluated') {
    if (module.EvaluationError === Value.undefined) {
      // If the module is already fully evaluated, it doesn't take part in cycles anymore.
      // Reset its CycleRoot to be itself.
      if (module.Status === 'evaluated' && !stack.includes(module.CycleRoot)) {
        module.CycleRoot = module;
      }
      return index;
    } else {
      return module.EvaluationError;
    }
  }
  if (module.Status === 'evaluating') {
    return index;
  }
  Assert(module.Status === 'linked' || module.Status === 'async-subgraphs-searching' || module.Status === 'async-subgraphs-searching-async' || module.Status === 'async-subgraphs-evaluated');
  module.Status = 'evaluating';
  module.DFSIndex = index;
  module.DFSAncestorIndex = index;
  module.PendingAsyncDependencies = 0;
  module.AsyncParentModules = [];
  module.AsyncEvaluation = Value.false;
  index += 1;
  stack.push(module);
  for (const { Specifier: required, Phase: phase } of module.RequestedModules) {
    const requiredModule = GetImportedModule(module, required);
    if (phase === 'defer') {
      index = Q(InnerAsyncSubgraphsEvaluation(requiredModule, stack, index));
    } else {
      index = Q(InnerModuleEvaluation(requiredModule, stack, index));
    }
    if (requiredModule instanceof CyclicModuleRecord) {
      Q(AfterCyclicModuleRecordEvaluation(module, requiredModule, stack));
    }
  }
  if (module.PendingAsyncDependencies > 0 || module.HasTLA === Value.true) {
    module.AsyncEvaluation = Value.true;
    if (module.PendingAsyncDependencies === 0) {
      X(ExecuteAsyncModule(module));
    }
  } else {
    Q(module.ExecuteModule());
  }
  Assert(stack.includes(module));
  Assert(module.DFSAncestorIndex <= module.DFSIndex);
  if (module.DFSAncestorIndex === module.DFSIndex) {
    let done = false;
    while (done === false) {
      const requiredModule = stack.pop();
      Assert(requiredModule instanceof CyclicModuleRecord);
      if (requiredModule.AsyncEvaluation === Value.false) {
        Assert(requiredModule.Status === 'evaluating');
        requiredModule.Status = 'evaluated';
      } else if (requiredModule.Status === 'async-subgraphs-searching') {
        requiredModule.Status = 'async-subgraphs-searching-async';
      } else {
        Assert(requiredModule.Status === 'evaluating');
        requiredModule.Status = 'evaluating-async';
      }
      if (requiredModule === module && !stack.includes(module)) {
        done = true;
      }
      requiredModule.CycleRoot = module;
    }
    done = false;
    while (done === false && stack.length > 0) {
      const requiredModule = stack[stack.length - 1];
      if (requiredModule.Status === 'evaluating-async' || requiredModule.Status === 'evaluated') {
        stack.pop();
      } else {
        done = true;
      }
    }
  }
  return index;
}

function AfterCyclicModuleRecordEvaluation(module, requiredModule, stack) {
  Assert(requiredModule.Status === 'async-subgraphs-searching' || requiredModule.Status === 'async-subgraphs-searching-async' || requiredModule.Status === 'async-subgraphs-evaluated' || requiredModule.Status === 'evaluating' || requiredModule.Status === 'evaluating-async' || requiredModule.Status === 'evaluated');
  Assert((requiredModule.Status === 'async-subgraphs-searching' || requiredModule.Status === 'evaluating') === stack.includes(requiredModule));
  if (requiredModule.Status === 'evaluating' || (requiredModule.Status === 'async-subgraphs-searching' && module.Status === 'async-subgraphs-searching')) {
    module.DFSAncestorIndex = Math.min(module.DFSAncestorIndex, requiredModule.DFSAncestorIndex);
  } else if (requiredModule.Status !== 'async-subgraphs-searching') {
    requiredModule = requiredModule.CycleRoot;
    Assert(requiredModule.Status === 'async-subgraphs-searching-async' || requiredModule.Status === 'async-subgraphs-evaluated' || requiredModule.Status === 'evaluating-async' || requiredModule.Status === 'evaluated');
    if (requiredModule.EvaluationError !== Value.undefined) {
      return module.EvaluationError;
    }
  }
  if (requiredModule.AsyncEvaluation === Value.true && module.Status !== 'evaluated' && module.Status !== 'async-subgraphs-evaluated') {
    module.PendingAsyncDependencies += 1;
    requiredModule.AsyncParentModules.push(module);
  }
}

/** http://tc39.es/ecma262/#sec-innermoduleevaluation */
export function InnerAsyncSubgraphsEvaluation(module, stack, index) {
  if (!(module instanceof CyclicModuleRecord) || module.HasTLA === Value.true) {
    return InnerModuleEvaluation(module, stack, index);
  }
  if (module.Status === 'async-subgraphs-searching-async' || module.Status === 'async-subgraphs-evaluated' || module.Status === 'evaluating-async' || module.Status === 'evaluated') {
    if (module.EvaluationError === Value.undefined) {
      return index;
    } else {
      return module.EvaluationError;
    }
  }
  if (module.Status === 'async-subgraphs-searching' || module.Status === 'evaluating') {
    return index;
  }
  Assert(module.Status === 'linked');
  module.Status = 'async-subgraphs-searching';
  module.DFSIndex = index;
  module.DFSAncestorIndex = index;
  module.PendingAsyncDependencies = 0;
  module.AsyncParentModules = [];
  index += 1;
  stack.push(module);
  for (const { Specifier: required } of module.RequestedModules) {
    const requiredModule = GetImportedModule(module, required);
    index = Q(InnerAsyncSubgraphsEvaluation(requiredModule, stack, index));
    if (requiredModule instanceof CyclicModuleRecord) {
      Q(AfterCyclicModuleRecordEvaluation(module, requiredModule, stack));
    }
  }
  if (module.PendingAsyncDependencies > 0) {
    module.AsyncEvaluation = Value.true;
  }
  Assert(stack.indexOf(module) === stack.lastIndexOf(module));
  Assert(module.DFSAncestorIndex <= module.DFSIndex);
  if (module.DFSAncestorIndex === module.DFSIndex) {
    let done = false;
    while (done === false) {
      const requiredModule = stack.pop();
      Assert(requiredModule instanceof CyclicModuleRecord);
      if (requiredModule.AsyncEvaluation === Value.false) {
        if (requiredModule.Status === 'async-subgraphs-searching') {
          requiredModule.Status = 'async-subgraphs-evaluated';
        } else {
          Assert(requiredModule.Status === 'evaluating');
          requiredModule.Status = 'evaluated';
        }
      } else {
        if (requiredModule.Status === 'async-subgraphs-searching') {
          requiredModule.Status = 'async-subgraphs-searching-async';
        } else {
          Assert(requiredModule.Status === 'evaluating');
          requiredModule.Status = 'evaluating-async';
        }
      }
      if (requiredModule === module) {
        done = true;
      }
      requiredModule.CycleRoot = module;
    }
  }
  return index;
}

/** http://tc39.es/ecma262/#sec-execute-async-module */
function ExecuteAsyncModule(module) {
  // 1. Assert: module.[[Status]] is evaluating or evaluating-async.
  Assert(module.Status === 'evaluating' || module.Status === 'evaluating-async');
  // 2. Assert: module.[[HasTLA]] is true.
  Assert(module.HasTLA === Value.true);
  // 3. Set module.[[AsyncEvaluation]] to true.
  module.AsyncEvaluation = Value.true;
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

/** https://tc39.es/ecma262/#sec-gather-available-ancestors */
function GatherAvailableAncestors(module, execList) {
  for (const m of module.AsyncParentModules) {
    if (!execList.includes(m) && m.CycleRoot.EvaluationError === Value.undefined && m.Status !== 'evaluated') {
      Assert(m.Status === 'async-subgraphs-searching-async' || m.Status === 'evaluating-async');
      Assert(m.EvaluationError === Value.undefined);
      Assert(m.AsyncEvaluation === Value.true);
      Assert(m.PendingAsyncDependencies > 0);
      m.PendingAsyncDependencies -= 1;
      if (m.PendingAsyncDependencies === 0) {
        execList.push(m);
        if (m.HasTLA === Value.false) {
          GatherAvailableAncestors(m, execList);
        }
      }
    }
  }
}

/** http://tc39.es/ecma262/#sec-asyncmodulexecutionfulfilled */
function AsyncModuleExecutionFulfilled(module) {
  if (module.Status === 'evaluated') {
    Assert(module.EvaluationError !== Value.undefined);
    return Value.undefined;
  }
  Assert(module.Status === 'async-subgraphs-searching-async' || module.Status === 'evaluating-async');
  Assert(module.AsyncEvaluation === Value.true);
  Assert(module.EvaluationError === Value.undefined);
  module.AsyncEvaluation = Value.false;
  module.Status = 'evaluated';
  if (module.TopLevelCapability !== Value.undefined) {
    Assert(module.CycleRoot === module);
    X(Call(module.TopLevelCapability.Resolve, Value.undefined, [Value.undefined]));
  }
  const execList = [];
  GatherAvailableAncestors(module, execList);
  // TODO: Sort this
  // 10. Let sortedExecList be a List whose elements are the elements of execList, in the order in which they had their [[AsyncEvaluation]] fields set to true in InnerModuleEvaluation.
  const sortedExecList = execList;
  Assert(sortedExecList.every((m) => m.AsyncEvaluation === Value.true && m.PendingAsyncDependencies === 0 && m.EvaluationError === Value.undefined));

  for (const m of sortedExecList) {
    if (m.Status === 'evaluated') {
      Assert(m.EvaluationError !== Value.undefined);
    } else if (m.HasTLA === Value.true) {
      ExecuteAsyncModule(m);
    } else {
      let success = false;
      if (m.Status === 'async-subgraphs-searching-async') {
        m.Status = 'async-subgraphs-evaluated';
        success = true;
      } else {
        const result = m.ExecuteModule();
        if (result instanceof AbruptCompletion) {
          X(AsyncModuleExecutionRejected(m, result.Value));
        } else {
          m.Status = 'evaluated';
          success = true;
        }
      }
      if (success && m.TopLevelCapability !== Value.undefined) {
        Assert(m.CycleRoot === m);
        X(Call(m.TopLevelCapability.Resolve, Value.undefined, [Value.undefined]));
      }
    }
  }
}

/** http://tc39.es/ecma262/#sec-AsyncModuleExecutionRejected */
function AsyncModuleExecutionRejected(module, error) {
  if (module.Status === 'evaluated') {
    Assert(module.EvaluationError !== Value.undefined);
    return Value.undefined;
  }
  Assert(module.Status === 'evaluating-async');
  Assert(module.AsyncEvaluation === Value.true);
  Assert(module.EvaluationError === Value.undefined);
  module.EvaluationError = ThrowCompletion(error);
  module.Status = 'evaluated';
  for (const m of module.AsyncParentModules) {
    AsyncModuleExecutionRejected(m, error);
  }
  if (module.TopLevelCapability !== Value.undefined) {
    Assert(module.DFSIndex === module.DFSAncestorIndex);
    X(Call(module.TopLevelCapability.Reject, Value.undefined, [error]));
  }
}

function getRecordWithSpecifier(loadedModules, specifier) {
  for (const record of loadedModules) {
    if (record.Specifier.stringValue() === specifier.stringValue()) {
      return record;
    }
  }
  return undefined;
}

/** http://tc39.es/ecma262/#sec-GetImportedModule */
export function GetImportedModule(referrer, specifier) {
  const record = getRecordWithSpecifier(referrer.LoadedModules, specifier);
  Assert(record !== undefined);
  return record.Module;
}

/** http://tc39.es/ecma262/#sec-FinishLoadingImportedModule */
export function FinishLoadingImportedModule(referrer, specifier, result, state) {
  // 1. If result is a normal completion, then
  if (result.Type === 'normal') {
    // a. If referrer.[[LoadedModules]] contains a Record whose [[Specifier]] is specifier, then
    const record = getRecordWithSpecifier(referrer.LoadedModules, specifier);
    if (record !== undefined) {
      // i. Assert: That Record's [[Module]] is result.[[Value]].
      Assert(record.Module === result.Value);
    } else {
    // b. Else, append the Record { [[Specifier]]: specifier, [[Module]]: result.[[Value]] } to referrer.[[LoadedModules]].
      referrer.LoadedModules.push({ Specifier: specifier, Module: result.Value });
    }
  }

  // 2. If payload is a GraphLoadingState Record, then
  if (state instanceof GraphLoadingState) {
    // a. Perform ContinueModuleLoading(payload, result).
    ContinueModuleLoading(state, result);
  // 3. Else,
  } else {
    // a. Perform ContinueDynamicImport(payload, result).
    ContinueDynamicImport(state, result);
  }

  // 4. Return unused.
}

/** http://tc39.es/ecma262/#sec-getmodulenamespace */
export function GetModuleNamespace(module) {
  // 1. Assert: If module is a Cyclic Module Record, then module.[[Status]] is not new or unlinked.
  if (module instanceof CyclicModuleRecord) {
    Assert(module.Status !== 'new' && module.Status !== 'unlinked');
  }
  // 2. Let namespace be module.[[Namespace]].
  let namespace = module.Namespace;
  // 3. If namespace is empty, then
  if (namespace === Value.undefined) {
    // a. Let exportedNames be module.GetExportedNames().
    const exportedNames = module.GetExportedNames();
    // b. Let unambiguousNames be a new empty List.
    const unambiguousNames = [];
    // c. For each element name of exportedNames, do
    for (const name of exportedNames) {
      // i. Let resolution be module.ResolveExport(name).
      const resolution = module.ResolveExport(name);
      // ii. If resolution is a ResolvedBinding Record, append name to unambiguousNames.
      if (resolution instanceof ResolvedBindingRecord) {
        unambiguousNames.push(name);
      }
    }
    // d. Set namespace to ModuleNamespaceCreate(module, unambiguousNames).
    namespace = ModuleNamespaceCreate(module, unambiguousNames);
  }
  // 4. Return namespace.
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

/** http://tc39.es/ecma262/#sec-create-default-export-synthetic-module */
export function CreateDefaultExportSyntheticModule(defaultExport, realm, hostDefined) {
  // 1. Let closure be the a Abstract Closure with parameters (module) that captures defaultExport and performs the following steps when called:
  const closure = (module) => { // eslint-disable-line arrow-body-style
    // a. Return ? module.SetSyntheticExport("default", defaultExport).
    return Q(module.SetSyntheticExport(new Value('default'), defaultExport));
  };
  // 2. Return CreateSyntheticModule(« "default" », closure, realm)
  return CreateSyntheticModule([new Value('default')], closure, realm, hostDefined);
}
