/**
 * README
 *
 * This branch contains an experimental version of an ESM graph evaluation
 * algorithm that supports deferred evaluation with eager pre-evaluation of
 * the async modules (and their dependencies) in the graph.
 *
 * The goal of this experiment was only to test the algorithm, and not the
 * syntax and and the other semantic parts of the proposal. To minimize the
 * effort spent on those, this demo uses:
 * - `import! "x"` instead of `import defer * as ns from "x"` to specify
 *   deferred imports
 * - `forceEvaluation("x")` instead of `ns.someProperty` to force the
 *   evaluation of the deferred module.
 *
 * You can find a few tests below. In each graph, the entry point is `"a"`.
 *
 * If you want to manually run these tests, follow these steps:
 * - Install engine262's deps with `npm install`
 * - Build engine262 with `npm run build`
 * - Run this file with `node demo.mjs`
 */

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
    import! "c";
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
    import! "c";
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
    import! "c";
    print("a");
  `,

  c: `
    import "e";
    print("c");
  `,

  e: `
    import! "c";
    print("e - start");
    await 0;
    print("e - finish");
  `,
}, ["'e - start'", "'e - finish'", "'a'"]);

await test('#2 - forceEvaluation', {
  a: `
    import! "c";
    print("a");
    forceEvaluation("c");
  `,

  c: `
    import "e";
    print("c");
  `,

  e: `
    import! "c";
    print("e - start");
    await 0;
    print("e - finish");
  `,
}, ["'e - start'", "'e - finish'", "'a'", "'c'"]);

await test('#2.1', {
  a: `
    import "b";
    import! "c";
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
    import! "c";
    print("e - start");
    await 0;
    print("e - finish");
  `,
}, ["'b'", "'e - start'", "'e - finish'", "'a'"]);

await test('#2.1 - forceEvaluation', {
  a: `
    import "b";
    import! "c";
    print("a");
    forceEvaluation("c");
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
    import! "c";
    print("e - start");
    await 0;
    print("e - finish");
  `,
}, ["'b'", "'e - start'", "'e - finish'", "'a'", "'d'", "'c'"]);

await test('#3', {
  a: `
    import! "c";
    print("a");
  `,

  c: `
    import "e";
    print("c");
  `,

  e: `
    import! "a";
    print("e - start");
    await 0;
    print("e - finish");
  `,
}, ["'e - start'", "'e - finish'", "'a'"]);

await test('#3 - forceEvaluation', {
  a: `
    import! "c";
    print("a");
    forceEvaluation("c");
  `,

  c: `
    import "e";
    print("c");
  `,

  e: `
    import! "a";
    print("e - start");
    await 0;
    print("e - finish");
  `,
}, ["'e - start'", "'e - finish'", "'a'", "'c'"]);

await test('#3.1', {
  a: `
    import "b";
    import! "c";
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
    import! "a";
    print("e - start");
    await 0;
    print("e - finish");
  `,
}, ["'b'", "'e - start'", "'e - finish'", "'a'"]);

await test('#3.1 - forceEvaluation', {
  a: `
    import "b";
    import! "c";
    print("a");
    forceEvaluation("c");
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
    import! "a";
    print("e - start");
    await 0;
    print("e - finish");
  `,
}, ["'b'", "'e - start'", "'e - finish'", "'a'", "'d'", "'c'"]);

await test("#4", {
  a: `
    import! "b";
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
    import! "b";
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
    import! "b";
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
    import! "e";
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
    import! "b";
    print("a");
    forceEvaluation("b");
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
    import! "e";
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
    import! "b";
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
    import! "e";
    print("d");
    forceEvaluation("e");
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
}, ["'f - start'", "'f - finish'", "'d'", "'e'", "'c - start'", "'c - finish'", "'a'"]);

await test("#5 - forceEvaluation(e from d, b from a)", {
  a: `
    import! "b";
    print("a");
    forceEvaluation("b");
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
    import! "e";
    print("d");
    forceEvaluation("e");
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
}, ["'f - start'", "'f - finish'", "'d'", "'e'", "'c - start'", "'c - finish'", "'a'", "'b'"]);

await test("#5 - forceEvaluation(e from a, b from a)", {
  a: `
    import! "b";
    print("a");
    forceEvaluation("e");
    forceEvaluation("b");
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
    import! "e";
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

      const forceEvaluation = new Value((args) => {
        // eslint-disable-next-line no-shadow
        const name = args[0].string;
        const module = registry[name];
        return module.Evaluate();
      });
      CreateDataProperty(
        realm.GlobalObject,
        new Value('forceEvaluation'),
        forceEvaluation,
      );

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
