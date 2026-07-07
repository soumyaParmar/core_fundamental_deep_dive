// ==========================================
// Custom Redux & React-Redux Library
// ==========================================

// Helper: Compose functions from right to left
function compose(...funcs) {
  if (funcs.length === 0) return arg => arg;
  if (funcs.length === 1) return funcs[0];
  return funcs.reduce((a, b) => (...args) => a(b(...args)));
}

// createStore: Central state container
function createStore(reducer, preloadedState, enhancer) {
  if (typeof preloadedState === "function" && typeof enhancer === "undefined") {
    enhancer = preloadedState;
    preloadedState = undefined;
  }

  if (typeof enhancer === "function") {
    return enhancer(createStore)(reducer, preloadedState);
  }

  let currentState = preloadedState;
  let currentListeners = [];

  function getState() {
    return currentState;
  }

  function subscribe(listener) {
    currentListeners.push(listener);
    return function unsubscribe() {
      currentListeners = currentListeners.filter(l => l !== listener);
    };
  }

  function dispatch(action) {
    if (typeof action.type === "undefined") {
      throw new Error("Actions must have a type property.");
    }
    currentState = reducer(currentState, action);
    currentListeners.forEach(listener => listener());
    return action;
  }

  dispatch({ type: "@@redux/INIT" });

  return {
    getState,
    dispatch,
    subscribe,
  };
}

// combineReducers: Combines multiple reducers
function combineReducers(reducers) {
  const reducerKeys = Object.keys(reducers);
  
  return function combination(state = {}, action) {
    let hasChanged = false;
    const nextState = {};
    
    for (let i = 0; i < reducerKeys.length; i++) {
      const key = reducerKeys[i];
      const reducer = reducers[key];
      const previousStateForKey = state[key];
      const nextStateForKey = reducer(previousStateForKey, action);
      
      nextState[key] = nextStateForKey;
      hasChanged = hasChanged || nextStateForKey !== previousStateForKey;
    }
    
    return hasChanged ? nextState : state;
  };
}

// applyMiddleware: Configures middleware chains
function applyMiddleware(...middlewares) {
  return (createStore) => (reducer, preloadedState) => {
    const store = createStore(reducer, preloadedState);
    let dispatch = () => {
      throw new Error("Dispatching while constructing middleware is not allowed.");
    };

    const middlewareAPI = {
      getState: store.getState,
      dispatch: (...args) => dispatch(...args)
    };

    const chain = middlewares.map(middleware => middleware(middlewareAPI));
    dispatch = compose(...chain)(store.dispatch);

    return {
      ...store,
      dispatch
    };
  };
}

// Global context to distribute the store
const ReduxContext = React.createContext(null);

// Provider Component
function Provider({ store, children }) {
  return React.createElement(
    ReduxContext.Provider,
    { value: store },
    children
  );
}

// Custom Hook: useSelector
function useSelector(selector) {
  const store = React.useContext(ReduxContext);
  if (!store) {
    throw new Error("useSelector must be used inside a Provider");
  }

  const [, forceUpdate] = React.useReducer(x => x + 1, 0);
  const latestSelectedState = React.useRef(null);

  const selectedState = selector(store.getState());

  React.useLayoutEffect(() => {
    latestSelectedState.current = selectedState;
  });

  React.useEffect(() => {
    function checkForUpdates() {
      try {
        const newSelectedState = selector(store.getState());
        if (newSelectedState === latestSelectedState.current) {
          return;
        }
        latestSelectedState.current = newSelectedState;
        forceUpdate();
      } catch (err) {
        forceUpdate();
      }
    }

    const unsubscribe = store.subscribe(checkForUpdates);
    return unsubscribe;
  }, [store, selector]);

  return selectedState;
}

// Custom Hook: useDispatch
function useDispatch() {
  const store = React.useContext(ReduxContext);
  if (!store) {
    throw new Error("useDispatch must be used inside a Provider");
  }
  return store.dispatch;
}

// Export custom library
const CustomRedux = {
  createStore,
  combineReducers,
  applyMiddleware,
  Provider,
  useSelector,
  useDispatch
};
window.CustomRedux = CustomRedux;
