# ⚛️ React Deep Mastery

Welcome to the **React Deep Mastery** curriculum. This repository contains an exhaustive, production-grade, and internal-focused deep dive into React. The structure is designed to take you from a standard user of React to an engineer who understands React's source code, Fiber architecture, scheduling mechanisms, state management internals, version histories, and compiler toolchains deeply enough to **build your own React clone from scratch**.

Each section is organized into markdown files that follow an 8-stage pedagogical format:
1. **Definition:** Plain English explanation, strict technical terms, a one-line mental model, and physical code/engine location.
2. **Drill Down:** In-depth breakdown with tables, memory layouts, ASCII / Mermaid diagrams, and code snippets.
3. **Why It Exists:** Historical context, original limitations of predecessor technologies, and why this design choice was made.
4. **Internal Working:** Concrete analysis of React source code patterns, data structures, scheduling loops, and memory representation.
5. **Advantages:** Clear benefits, performance enhancements, and optimization wins.
6. **Disadvantages / Traps:** Micro-benchmarks, performance cliffs, common mistakes, anti-patterns, and the "good vs bad" pattern comparison.
7. **Production Usage:** Production-grade patterns, enterprise directory structures, and code architecture designs.
8. **Interview Questions:** Basic, Intermediate, Advanced, and "Explain Step-by-Step" questions.

---

## 🗺️ Curriculum Map

### 📦 [Section 01 — React Core Philosophy & Virtual DOM](./Section-01-React-Core-Philosophy-and-Virtual-DOM/)
*   **[1.1 — React Philosophy & Declarative Programming](./Section-01-React-Core-Philosophy-and-Virtual-DOM/1.1-react-philosophy-and-declarative-programming.md):** Declarative vs. Imperative programming paradigms, state-driven UI modeling ($UI = f(State)$), component-driven architectures.
*   **[1.2 — Virtual DOM & Reconciliation](./Section-01-React-Core-Philosophy-and-Virtual-DOM/1.2-virtual-dom-reconciliation-and-diffing-algorithm.md):** The Virtual DOM concept, the heuristic $O(n)$ diffing algorithm, element vs. component diffing, the critical role of key props, and batched updates.

### 🧵 [Section 02 — React Fiber Architecture Deep Dive](./Section-02-React-Fiber-Architecture-Deep-Dive/)
*   **[2.1 — Why Fiber & Cooperative Scheduling](./Section-02-React-Fiber-Architecture-Deep-Dive/2.1-why-fiber-and-cooperative-scheduling.md):** Limits of Stack Reconciler (call stack recursion), introduction of Fiber, time slicing, cooperative scheduling, and the use of `requestIdleCallback` / `MessageChannel`.
*   **[2.2 — Fiber Reconciliation & Work Loop](./Section-02-React-Fiber-Architecture-Deep-Dive/2.2-fiber-reconciliation-and-workloop.md):** The structure of a Fiber node (`child`, `sibling`, `return`, `alternate`, `memoizedState`, `updateQueue`, `flags`), double buffering (current vs. workInProgress trees), and the `workLoopSync` / `workLoopConcurrent`.
*   **[2.3 — Render & Commit Phases](./Section-02-React-Fiber-Architecture-Deep-Dive/2.3-render-and-commit-phases.md):** Deep comparison of the asynchronous, interruptible render phase (`beginWork`, `completeWork`) and the synchronous, DOM-mutating commit phase (`commitMutationEffects`, `commitLayoutEffects`).

### 🛠️ [Section 03 — Build Your Own React from Scratch](./Section-03-Build-Your-Own-React-from-Scratch/)
*   **[3.1 — CreateElement & Custom JSX](./Section-03-Build-Your-Own-React-from-Scratch/3.1-createElement-and-custom-jsx.md):** Developing a custom `createElement` function and setting up custom JSX Babel transpilation.
*   **[3.2 — Custom Fiber Reconciler & Work Loop](./Section-03-Build-Your-Own-React-from-Scratch/3.2-custom-fiber-reconciler-and-workloop.md):** Creating a concurrent-loop based virtual DOM reconciler, scheduling work, and executing DOM reconciliations.
*   **[3.3 — Custom Hooks: useState & useRef](./Section-03-Build-Your-Own-React-from-Scratch/3.3-custom-hooks-usestate-and-useref.md):** Implementing hook state tracking on Fibers using a sequential linked list and building a custom state updates queue.
*   **[3.4 — Custom Hooks: useEffect & useLayoutEffect](./Section-03-Build-Your-Own-React-from-Scratch/3.4-custom-hooks-useeffect-and-uselayouteffect.md):** Implementing effect queues, dependency checking, and managing synchronous (layout) vs. asynchronous (cleanup/paint) lifecycles.

### ⚓ [Section 04 — React Hooks and Lifecycle Mechanics](./Section-04-React-Hooks-and-Lifecycle-Mechanics/)
*   **[4.1 — Hooks Internal Linked List & Dispatcher](./Section-04-React-Hooks-and-Lifecycle-Mechanics/4.1-hooks-internal-linked-list-and-dispatcher.md):** Internal storage of hooks inside V18/V19 Fiber node's `memoizedState`, dispatcher objects, and why Hook Rules exist.
*   **[4.2 — State Hooks (useState & useReducer)](./Section-04-React-Hooks-and-Lifecycle-Mechanics/4.2-state-hooks-usestate-and-usereducer.md):** Updater circular queues, dispatch actions, render-phase state updates, and eager bailout mechanics.
*   **[4.3 — Effect Hooks (useEffect, useLayoutEffect, useInsertionEffect)](./Section-04-React-Hooks-and-Lifecycle-Mechanics/4.3-effect-hooks-useeffect-uselayouteffect-useinsertioneffect.md):** Trace of execution timing (passive effects, layout effects, style injections) relative to browser paint and reflow events.
*   **[4.4 — Memoization Hooks (useMemo, useCallback, useRef)](./Section-04-React-Hooks-and-Lifecycle-Mechanics/4.4-memoization-hooks-usememo-usecallback-and-useref.md):** Storing values/functions as dependencies, reference persistence, and using `useRef` as a non-rendering instance property.
*   **[4.5 — Concurrent Hooks (useTransition, useDeferredValue)](./Section-04-React-Hooks-and-Lifecycle-Mechanics/4.5-concurrent-hooks-usetransition-usedeferredvalue.md):** Lanes and priorities. Scheduling transitions, deferring values, and keeping the UI responsive under heavy computations.

### 🗃️ [Section 05 — State-Management and Redux Deep Dive](./Section-05-State-Management-and-Redux-Deep-Dive/)
*   **[5.1 — Redux Core Architecture](./Section-05-State-Management-and-Redux-Deep-Dive/5.1-redux-core-architecture.md):** Single source of truth, read-only state, pure reducers, action dispatches, and middleware pipelines.
*   **[5.2 — Build Your Own Redux from Scratch](./Section-05-State-Management-and-Redux-Deep-Dive/5.2-build-your-own-redux-from-scratch.md):** Writing a full Redux core library (`createStore`, `combineReducers`, `applyMiddleware` currying) along with custom React bindings (`Provider`, hook-based `useSelector`, and `useDispatch`).

### ⚙️ [Section 06 — Compilation, Bundlers, and Tooling](./Section-06-Compilation-Bundlers-and-Tooling/)
*   **[6.1 — Webpack from Scratch](./Section-06-Compilation-Bundlers-and-Tooling/6.1-webpack-from-scratch-without-cra.md):** Configuring Babel loaders, CSS processors, optimization split-chunks, and output files from absolute scratch.
*   **[6.2 — Vite Architecture & HMR](./Section-06-Compilation-Bundlers-and-Tooling/6.2-vite-architecture-and-hmr.md):** Vite's dev server vs Webpack, Esbuild pre-bundling, native browser ESM, Rollup production compilation, and how HMR works at the socket level.
*   **[6.3 — Code Splitting & Lazy Loading](./Section-06-Compilation-Bundlers-and-Tooling/6.3-code-splitting-and-lazy-loading.md):** Dynamic imports (`import()`), React `lazy`, `Suspense`, bundle loading states, and chunks generation.

### 🚀 [Section 07 — React Version Evolution (Below 16 to 19)](./Section-07-React-Version-Evolution-Below-16-to-19/)
*   **[7.1 — React Below 16 vs 16 vs 17](./Section-07-React-Version-Evolution-Below-16-to-19/7.1-react-below-16-vs-16-vs-17.md):** Stack Reconciler lifecycle methods (`componentWillMount`, `componentWillReceiveProps`) compared to Fiber introduction, Error Boundaries, portals, event delegating targets, and hook runtimes.
*   **[7.2 — React 18 vs 19 Deep Dive](./Section-07-React-Version-Evolution-Below-16-to-19/7.2-react-18-vs-19-deep-dive.md):** Automatic batching, Concurrent rendering, Transitions vs. React 19 Actions (`useActionState`, `useFormStatus`, `useOptimistic`), `use` API, removal of `forwardRef`, direct ref props, asset preload, and React Server Components (RSC).
