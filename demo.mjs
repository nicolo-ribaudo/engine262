/* eslint-disable */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const assert = require('assert/strict');
const {
  Agent,
  setSurroundingAgent,
  ManagedRealm,
  Value,

  CreateDataProperty,
  Throw,
  AbruptCompletion,
  NormalCompletion,

  inspect,
  PerformPromiseThen,
  runJobQueue,
} = require('.');

const mapObj = (f) => (obj) => Object.fromEntries(Object.entries(obj).map(f));

const agent = new Agent({
  loadImportedModule(referrer, specifier, hostDefined, finish) {
    const { registry } = referrer.HostDefined;
    // Async!
    if (Object.hasOwn(registry, specifier)) {
      finish(NormalCompletion(registry[specifier]));
    } else {
      finish(Throw('Error', 'Raw', `Module ${specifier} not found.`));
    }
  },
});
setSurroundingAgent(agent);

// function only() { return "#1" }

await test('#1', {
  a: `
    import defer * as ns from "c";
    print("a");
  `,

  c: `
    import "e";
    print("c");
  `,

  e: `
    import "c";
    print("e - start");
    await 0;
    print("e - finish");
  `,
}, ["'c'", "'e - start'", "'e - finish'", "'a'"]);

// function only() { return "#1.1" }

await test('#1.1', {
  a: `
    import "b";
    import defer * as ns from "c";
    print("a");
  `,

  b: `
    print("b");
  `,

  c: `
    import "d";
    import "e";
    print("c");
  `,

  d: `
    print("d");
  `,

  e: `
    import "c";
    print("e - start");
    await 0;
    print("e - finish");
  `,
}, ["'b'", "'d'", "'c'", "'e - start'", "'e - finish'", "'a'"]);

await test('#2', {
  a: `
    import defer * as ns from "c";
    print("a");
  `,

  c: `
    import "e";
    print("c");
  `,

  e: `
    import defer * as ns from "c";
    print("e - start");
    await 0;
    print("e - finish");
  `,
}, ["'e - start'", "'e - finish'", "'a'"]);

await test('#2 - forceEvaluation', {
  a: `
    import defer * as ns from "c";
    print("a");
    ns.c;
  `,

  c: `
    import "e";
    print("c");
    export const c = 1;
  `,

  e: `
    import defer * as ns from "c";
    print("e - start");
    await 0;
    print("e - finish");
  `,
}, ["'e - start'", "'e - finish'", "'a'", "'c'"]);

await test('#2.1', {
  a: `
    import "b";
    import defer * as ns from "c";
    print("a");
  `,

  b: `
    print("b");
  `,

  c: `
    import "d";
    import "e";
    print("c");
  `,

  d: `
    print("d");
  `,

  e: `
    import defer * as ns from "c";
    print("e - start");
    await 0;
    print("e - finish");
  `,
}, ["'b'", "'e - start'", "'e - finish'", "'a'"]);

await test('#2.1 - forceEvaluation', {
  a: `
    import "b";
    import defer * as ns from "c";
    print("a");
    ns.c;
  `,

  b: `
    print("b");
  `,

  c: `
    import "d";
    import "e";
    print("c");
    export const c = 1;
  `,

  d: `
    print("d");
  `,

  e: `
    import defer * as ns from "c";
    print("e - start");
    await 0;
    print("e - finish");
  `,
}, ["'b'", "'e - start'", "'e - finish'", "'a'", "'d'", "'c'"]);

await test('#3', {
  a: `
    import defer * as ns from "c";
    print("a");
  `,

  c: `
    import "e";
    print("c");
  `,

  e: `
    import defer * as ns from "a";
    print("e - start");
    await 0;
    print("e - finish");
  `,
}, ["'e - start'", "'e - finish'", "'a'"]);

await test('#3 - forceEvaluation', {
  a: `
    import defer * as ns from "c";
    print("a");
    ns.c;
  `,

  c: `
    import "e";
    print("c");
    export const c = 1;
  `,

  e: `
    import defer * as ns from "a";
    print("e - start");
    await 0;
    print("e - finish");
  `,
}, ["'e - start'", "'e - finish'", "'a'", "'c'"]);

await test('#3.1', {
  a: `
    import "b";
    import defer * as ns from "c";
    print("a");
  `,

  b: `
    print("b");
  `,

  c: `
    import "d";
    import "e";
    print("c");
  `,

  d: `
    print("d");
  `,

  e: `
    import defer * as ns from "a";
    print("e - start");
    await 0;
    print("e - finish");
  `,
}, ["'b'", "'e - start'", "'e - finish'", "'a'"]);

await test('#3.1 - forceEvaluation', {
  a: `
    import "b";
    import defer * as ns from "c";
    print("a");
    ns.c;
  `,

  b: `
    print("b");
  `,

  c: `
    import "d";
    import "e";
    print("c");
    export const c = 1;
  `,

  d: `
    print("d");
  `,

  e: `
    import defer * as ns from "a";
    print("e - start");
    await 0;
    print("e - finish");
  `,
}, ["'b'", "'e - start'", "'e - finish'", "'a'", "'d'", "'c'"]);

await test("#4", {
  a: `
    import defer * as ns from "b";
    import "c";
    import "b";
    print("a");
  `,

  b: `
    print("b");
  `,

  c: `
    print("c");
  `,
// Should this be 'c', 'b', 'a' instead?
}, ["'b'", "'c'", "'a'"]);

await test("#4.1", {
  a: `
    import defer * as ns from "b";
    import "c";
    import "b";
    print("a");
  `,

  b: `
    import "d";
    print("b");
  `,

  c: `
    import "d";
    print("c");
  `,

  d: `
    print("d - start");
    await 0;
    print("d - finish");
  `
// Shuld this be 'd - start', 'd - finish', 'c', 'b', 'a' instead?
}, ["'d - start'", "'d - finish'", "'b'", "'c'", "'a'"]);

await test("#5", {
  a: `
    import defer * as ns from "b";
    print("a");
  `,

  b: `
    import "c";
    print("b");
  `,

  c: `
    import "d";
    print("c - start");
    await 0;
    print("c - finish");
  `,

  d: `
    import defer * as ns from "e";
    print("d");
  `,

  e: `
    import "f";
    print("e");
  `,

  f: `
    import "a";
    print("f - start");
    await 0;
    print("f - finish");
  `,
}, ["'f - start'", "'f - finish'", "'d'", "'c - start'", "'c - finish'", "'a'"]);

await test("#5 - forceEvaluation(b from a)", {
  a: `
    import defer * as ns from "b";
    print("a");
    ns.b;
  `,

  b: `
    import "c";
    print("b");
    export const b = 1;
  `,

  c: `
    import "d";
    print("c - start");
    await 0;
    print("c - finish");
  `,

  d: `
    import defer * as ns from "e";
    print("d");
  `,

  e: `
    import "f";
    print("e");
  `,

  f: `
    import "a";
    print("f - start");
    await 0;
    print("f - finish");
  `,
}, ["'f - start'", "'f - finish'", "'d'", "'c - start'", "'c - finish'", "'a'", "'b'"]);

await test("#5 - forceEvaluation(e from d)", {
  a: `
    import defer * as ns from "b";
    print("a");
  `,

  b: `
    import "c";
    print("b");
  `,

  c: `
    import "d";
    print("c - start");
    await 0;
    print("c - finish");
  `,

  d: `
    import defer * as ns from "e";
    print("d");
    ns.e;
  `,

  e: `
    import "f";
    print("e");
    export const e = 1;
  `,

  f: `
    import "a";
    print("f - start");
    await 0;
    print("f - finish");
  `,
}, ["'f - start'", "'f - finish'", "'d'", "'e'", "'c - start'", "'c - finish'", "'a'"]);

await test("#5 - forceEvaluation(e from d, b from a)", {
  a: `
    import defer * as ns from "b";
    print("a");
    ns.b;
  `,

  b: `
    import "c";
    print("b");
    export const b = 1;
  `,

  c: `
    import "d";
    print("c - start");
    await 0;
    print("c - finish");
  `,

  d: `
    import defer * as ns from "e";
    print("d");
    ns.e;
  `,

  e: `
    import "f";
    print("e");
    export const e = 1;
  `,

  f: `
    import "a";
    print("f - start");
    await 0;
    print("f - finish");
  `,
}, ["'f - start'", "'f - finish'", "'d'", "'e'", "'c - start'", "'c - finish'", "'a'", "'b'"]);

await test("#5 - forceEvaluation(e from a, b from a)", {
  a: `
    import defer * as ns from "b";
    print("a");
    globalThis.nsE.e;
    ns.b;
  `,

  b: `
    import "c";
    print("b");
    export const b = 1;
  `,

  c: `
    import "d";
    print("c - start");
    await 0;
    print("c - finish");
  `,

  d: `
    import defer * as ns from "e";
    print("d");
    globalThis.nsE = ns;
  `,

  e: `
    import "f";
    print("e");
    export const e = 1;
  `,

  f: `
    import "a";
    print("f - start");
    await 0;
    print("f - finish");
  `,
}, ["'f - start'", "'f - finish'", "'d'", "'c - start'", "'c - finish'", "'a'", "'e'", "'b'"]);

function co(gen) {
  return new Promise((resolve, reject) => {
    const genObject = gen();
    const next = () => {
      const { value, done } = genObject.next();
      if (done) {
        resolve(value);
      } else {
        PerformPromiseThen(value, new Value(next), new Value(reject));
      }
    };
    next();
    runJobQueue();
  });
}

function test(name, modules, expected) {
  if (typeof only === "function" && only() !== name) return;
  const maybeLogToConsole = typeof only === "function" ? console.log : () => {};

  const logs = [];

  return new Promise((res, rej) => {
    const realm = new ManagedRealm();

    const registry = mapObj(([s, st]) => [s, realm.createSourceTextModule(s, st)])(modules);
    mapObj(([s, m]) => {
      if (m instanceof AbruptCompletion) {
        throw new SyntaxError(JSON.stringify(m));
      }
      m.HostDefined.registry = registry;
      return [s, 0];
    })(registry);

    realm.scope(() => {
      // Add print function from host
      const print = new Value((args) => {
        const str = args.map((tmp) => inspect(tmp)).join(' ');
        maybeLogToConsole(str);
        logs.push(str);
        return Value.undefined;
      });
      CreateDataProperty(realm.GlobalObject, new Value('print'), print);

      const { a: root } = registry;
      co(function* () {
        maybeLogToConsole("========= root.LoadRequestedModules() =========");
        yield root.LoadRequestedModules();
        maybeLogToConsole("================= root.Link() =================")
        const linkResult = root.Link();
        if (linkResult instanceof AbruptCompletion) {
          throw linkResult.Value;
        }
        maybeLogToConsole("=============== root.Evaluate() ===============");
        yield root.Evaluate();
        return Value.undefined;
      }).then(res, (err) => rej(err));
    });
  }).then(() => {
    assert.deepEqual(logs, expected);
  }).then(() => {
    console.log("PASS", name);
  }, err => {
    console.log("FAIL", name);
    console.log(String(err).replace(/^(.)/gm, '  $1'));
    process.exitCode = 1;
  });
}
