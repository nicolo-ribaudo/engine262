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
