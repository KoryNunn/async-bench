(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
module.exports = function(){
    function run(callback){
        run.count++;
        setTimeout(callback, 0);
    };

    run.count = 0;

    return run;
};
},{}],2:[function(require,module,exports){
var tests = [
    ['righto', require('./righto')],
    ['promise', require('./promise')],
    ['righto-parallel', require('./righto-parallel')],
    ['promise-parallel', require('./promise-parallel')],

    ['righto repeat', require('./righto')],
    ['promise repeat', require('./promise')],
    ['righto-parallel repeat', require('./righto-parallel')],
    ['promise-parallel repeat', require('./promise-parallel')]
];

// avoid noise with other libs
var series = require('foreign').series;

setTimeout(function(){
    series(function(test, callback){
        console.log('\n', test[0]);
        test[1](1000, callback);
    }, tests, function(){
        console.log('done');
    });
}, 5000);

},{"./promise":7,"./promise-parallel":6,"./righto":9,"./righto-parallel":8,"foreign":3}],3:[function(require,module,exports){
function parallel(fn, items, callback){
    if(!items || typeof items !== 'object'){
        throw new Error('Items must be an object or an array');
    }

    var keys = Object.keys(items),
        isArray = Array.isArray(items),
        length = isArray ? items.length : keys.length,
        finalResult = new items.constructor(),
        done = 0,
        errored;

    if(length === 0){
        return callback(null, finalResult);
    }

    function isDone(key){
        return function(error, result){

            if(errored){
                return;
            }

            if(error){
                errored = true;
                return callback(error);
            }

            finalResult[key] = arguments.length > 2 ? Array.prototype.slice.call(arguments, 1) : result;

            if(++done === length){
                callback(null, finalResult);
            }
        };
    }

    for (var i = 0; i < length; i++) {
        var key = keys[i];
        if(isArray && isNaN(key)){
            continue;
        }

        fn(items[key], isDone(key));
    }
}

function series(fn, items, callback){
    if(!items || typeof items !== 'object'){
        throw new Error('Items must be an object or an array');
    }

    var keys = Object.keys(items),
        isArray = Array.isArray(items),
        length = isArray ? items.length : keys.length,
        finalResult = new items.constructor();

    if(length === 0){
        return callback(null, finalResult);
    }

    function next(index){
        var key = keys[index];

        index++;

        if(isArray && isNaN(key)){
            return next(index);
        }

        fn(items[key], function (error, result) {
            if(error){
                return callback(error);
            }

            finalResult[key] = arguments.length > 2 ? Array.prototype.slice.call(arguments, 1) : result;

            if(index === length){
                return callback(null, finalResult);
            }

            next(index);
        });
    }

    next(0);
}

module.exports = {
    parallel: parallel,
    series: series
};
},{}],4:[function(require,module,exports){
(function (process){
var abbott = require('abbott');

var nextTick = process.nextTick || setTimeout;

function isRighto(x){
    return typeof x === 'function' && (x.__resolve__ === x || x.resolve === x);
}

function isThenable(x){
    return x && typeof x.then === 'function';
}

function isResolveable(x){
    return isRighto(x) || isThenable(x);
}

function isTake(x){
    return x && typeof x === 'object' && '__take__' in x;
}

var slice = Array.prototype.slice.call.bind(Array.prototype.slice);

function resolveDependency(task, done){
    if(isThenable(task)){
        task = righto(abbott(task));
    }

    if(isRighto(task)){
        return task(function(error){
            var results = slice(arguments, 1, 2);

            if(!results.length){
                results.push(undefined);
            }

            done(error, results);
        });
    }

    function take(targetTask){
        var keys = slice(arguments, 1);
        return targetTask(function(error){
            var args = slice(arguments, 1);
            done(error, keys.map(function(key){
                return args[key];
            }));
        });
    }

    if(Array.isArray(task) && isRighto(task[0]) && !isRighto(task[1])){
        return take.apply(null, task);
    }

    if(isTake(task)){
        return take.apply(null, task.__take__);
    }

    return done(null, [task]);
}

function get(fn){
    return righto(function(result, fn, done){
        if(typeof fn === 'string'){
            return done(null, result[fn]);
        }
        done(null, fn(result));
    }, this, fn);
}

var noOp = function(){};

function proxy(instance){
    instance._ = new Proxy(instance, {
        get: function(target, key){
            if(key === '__resolve__'){
                return instance._;
            }

            return proxy(righto.sync(function(result){
                return result[key];
            }, instance));
        }
    });
    instance.__resolve__ = instance._;
    return instance._;
}

function resolveIterator(fn){
    return function(){
        var args = slice(arguments),
            callback = args.pop(),
            errored,
            lastValue;

        function reject(error){
            if(errored){
                return;
            }
            errored = true;
            callback(error);
        }

        var generator = fn.apply(null, args.concat(reject));

        function run(){
            if(errored){
                return;
            }
            var next = generator.next(lastValue);
            if(next.done){
                if(errored){
                    return;
                }
                return callback(null, next.value);
            }
            if(isResolveable(next.value)){
                righto.sync(function(value){
                    lastValue = value;
                    run();
                }, next.value)(function(error){
                    if(error){
                        reject(error);
                    }
                });
                return;
            }
            lastValue = next.value;
            run();
        }

        run();
    };
}

function addTracing(resolve, fn, args){
    function getCallLine(stack){
        return stack.split('\n')[3].match(/at (.*)/)[1];
    }

    var argMatch = fn.toString().match(/^[\w\s]*?\(((?:\w+[,\s]*?)*)\)/),
        argNames = argMatch ? argMatch[1].split(/[,\s]+/g) : [];

    resolve._stack = new Error().stack;
    resolve._trace = function(tabs){
        tabs = tabs || 0;
        var spacing = '    ';
        for(var i = 0; i < tabs; i ++){
            spacing = spacing + '    ';
        }
        return args.map(function(arg, index){
            return [arg, argNames[index] || index];
        }).reduce(function(results, argInfo){
            var arg = argInfo[0],
                argName = argInfo[1];

            if(isTake(arg)){
                arg = arg.__take__[0];
            }

            if(isRighto(arg)){
                var line = spacing + '- argument "' + argName + '" from ';
                if(!arg._trace){
                    results.push(line + 'Tracing was not enabled for this righto instance.');
                }else{
                    results.push(line + arg._trace(tabs + 1));
                }
            }

            return results;
        }, [getCallLine(resolve._stack)])
        .join('\n');
    };
}

function taskComplete(){
    var context = this[2],
        results = arguments;
    this[0](results);
    this[1].forEach(function(callback){
        callback.apply(context, results);
    });
}

function errorOut(callback){
    callback(this[0]);
}

function resolveWithDependencies(done, error, argResults){
    var fn = this[0],
        callbacks = this[1],
        context = this[2];

    if(error){
        return callbacks.forEach(errorOut.bind([error]));
    }

    var args = [].concat.apply([], argResults);

    args.push(taskComplete.bind([done, callbacks, context]));

    fn.apply(null, args);
}

function resolveDependencies(args, complete, resolveDependency){
    var results = [],
        done = 0,
        hasErrored;

    if(!args.length){
        complete(null, []);
    }

    function dependencyResolved(index, error, result){
        if(hasErrored){
            return;
        }

        if(error){
            hasErrored = true;
            return complete(error);
        }

        results[index] = result;

        if(++done === args.length){
            complete(null, results);
        }
    }

    args.forEach(function(arg, index){
        resolveDependency(arg, dependencyResolved.bind(null, index));
    });
}

function righto(fn){
    var args = slice(arguments),
        fn = args.shift(),
        context = this,
        started = 0,
        callbacks = [],
        results;


    if(typeof fn !== 'function'){
        throw new Error('No task function passed to righto');
    }

    function resolve(callback){

        // No callback? Just run the task.
        if(!arguments.length){
            callback = noOp;
        }

        if(typeof callback !== 'function'){
            throw new Error('Callback must be a function');
        }

        if(results){
            return callback.apply(context, results);
        }

        if(righto._debug){
            if(righto._autotrace || resolve._traceOnExecute){
                console.log('Executing ' + fn.name + ' ' + resolve._trace());
            }
        }

        callbacks.push(callback);

        if(started++){
            return;
        }

        var complete = resolveWithDependencies.bind([fn, callbacks, context], function(resolvedResults){
                results = resolvedResults;
            });

        nextTick(resolveDependencies.bind(null, args, complete, resolveDependency));
    };

    resolve.get = get.bind(resolve);
    resolve.resolve = resolve;

    if(righto._debug){
        addTracing(resolve, fn, args);
    }

    return resolve;
}

righto.sync = function(fn){
    return righto.apply(null, [function(){
        var args = slice(arguments),
            done = args.pop();

        nextTick(function(){
            done(null, fn.apply(null, args));
        });
    }].concat(slice(arguments, 1)));
};

righto.all = function(task){
    if(arguments.length > 1){
        task = slice(arguments);
    }

    function resolve(tasks){
        return righto.apply(null, [function(){
            arguments[arguments.length - 1](null, slice(arguments, 0, -1));
        }].concat(tasks));
    }

    if(isRighto(task)){
        return righto(function(tasks, done){
            resolve(tasks)(done);
        }, task);
    }

    return resolve(task);
};

righto.from = function(value){
    if(isRighto(value)){
        return value;
    }

    return righto.sync(function(resolved){
        return resolved;
    }, value);
};

righto.mate = function(){
    return righto.apply(null, [function(){
        arguments[arguments.length -1].apply(null, [null].concat(slice(arguments, 0, -1)));
    }].concat(slice(arguments)));
};

righto.take = function(){
    return {__take__: slice(arguments)};
};

righto.after = function(task){
    if(arguments.length === 1){
        return {__take__: [task]};
    }

    return {__take__: [righto.mate.apply(null, arguments)]};
};

righto.resolve = function(object, deep){
    if(isRighto(object)){
        return righto.sync(function(object){
            return righto.resolve(object, deep);
        }, object);
    }

    if(!object || !(typeof object === 'object' || typeof object === 'function')){
        return righto.from(object);
    }

    var pairs = righto.all(Object.keys(object).map(function(key){
        return righto(function(value, done){
            if(deep){
                righto.sync(function(value){
                    return [key, value];
                }, righto.resolve(value, true))(done);
                return;
            }
            done(null, [key, value]);
        }, object[key]);
    }));

    return righto.sync(function(pairs){
        return pairs.reduce(function(result, pair){
            result[pair[0]] = pair[1];
            return result;
        }, {});
    }, pairs);
};

righto.iterate = function(){
    var args = slice(arguments),
        fn = args.shift();

    return righto.apply(null, [resolveIterator(fn)].concat(args));
};

righto.value = function(){
    var args = arguments;
    return righto(function(done){
        done.apply(null, [null].concat(slice(args)));
    });
};

righto.surely = function(task){
    if(!isResolveable(task)){
        task = righto.apply(null, arguments);
    }

    return righto(function(done){
        task(function(){
            done(null, slice(arguments));
        });
    });
};

righto.proxy = function(){
    if(typeof Proxy === 'undefined'){
        throw new Error('This environment does not support Proxy\'s');
    }

    return proxy(righto.apply(this, arguments));
};

for(var key in righto){
    righto.proxy[key] = righto[key];
}

module.exports = righto;
}).call(this,require('_process'))

},{"_process":10,"abbott":5}],5:[function(require,module,exports){
function checkIfPromise(promise){
    if(!promise || typeof promise !== 'object' || typeof promise.then !== 'function'){
        throw "Abbott requires a promise to break. It is the only thing Abbott is good at.";
    }
}

module.exports = function abbott(promiseOrFn){
    if(typeof promiseOrFn !== 'function'){
        checkIfPromise(promiseOrFn);
    }

    return function(){
        var promise;
        if(typeof promiseOrFn === 'function'){
           promise = promiseOrFn.apply(null, Array.prototype.slice.call(arguments, 0, -1));
        }else{
            promise = promiseOrFn;
        }

        checkIfPromise(promise);

        var callback = arguments[arguments.length-1];
        promise.then(callback.bind(null, null), callback);
    };
};
},{}],6:[function(require,module,exports){
var righto = require('righto'),
    after = require('./after');

module.exports = function(iterations, callback){
    var counter = after(),
        initStart = Date.now();

    var tasks = [];

    for(var i = 0; i < iterations; i++){
        tasks.push(new Promise(counter));
    }

    var doAll = Promise.all(tasks);

    var executeStart = Date.now();
    console.log('init time: ', executeStart - initStart);

    doAll.then(function(){
        console.log(counter.count);
        var completedTime = Date.now();
        console.log('execute time: ', completedTime - executeStart);
        console.log('total time: ', completedTime - initStart);
        callback();
    });
}
},{"./after":1,"righto":4}],7:[function(require,module,exports){
var righto = require('righto'),
    after = require('./after');

module.exports = function(iterations, callback){
    var counter = after(),
        initStart = Date.now();

    var last = new Promise(counter);

    for(var i = 0; i < iterations; i++){
        last = last.then(function(){
            return new Promise(counter);
        });
    }

    var executeStart = Date.now();
    console.log('init time: ', executeStart - initStart);

    last.then(function(){
        console.log(counter.count);
        var completedTime = Date.now();
        console.log('execute time: ', completedTime - executeStart);
        console.log('total time: ', completedTime - initStart);
        callback();
    });
};
},{"./after":1,"righto":4}],8:[function(require,module,exports){
var righto = require('righto'),
    after = require('./after');

module.exports = function(iterations, callback){
    var counter = after(),
        initStart = Date.now();

    var tasks = [];

    for(var i = 0; i < iterations; i++){
        tasks.push(righto(counter));
    }

    var doAll = righto.all(tasks);

    var executeStart = Date.now();
    console.log('init time: ', executeStart - initStart);

    doAll(function(){
        console.log(counter.count);
        var completedTime = Date.now();
        console.log('execute time: ', completedTime - executeStart);
        console.log('total time: ', completedTime - initStart);
        callback();
    });
}
},{"./after":1,"righto":4}],9:[function(require,module,exports){
var righto = require('righto'),
    after = require('./after');

module.exports = function(iterations, callback){
    var counter = after(),
        initStart = Date.now();

    var last = righto(counter);

    for(var i = 0; i < iterations; i++){
        last = righto(counter, righto.after(last));
    }

    var executeStart = Date.now();
    console.log('init time: ', executeStart - initStart);

    last(function(){
        console.log(counter.count);
        var completedTime = Date.now();
        console.log('execute time: ', completedTime - executeStart);
        console.log('total time: ', completedTime - initStart);
        callback();
    });
}
},{"./after":1,"righto":4}],10:[function(require,module,exports){
// shim for using process in browser

var process = module.exports = {};
var queue = [];
var draining = false;

function drainQueue() {
    if (draining) {
        return;
    }
    draining = true;
    var currentQueue;
    var len = queue.length;
    while(len) {
        currentQueue = queue;
        queue = [];
        var i = -1;
        while (++i < len) {
            currentQueue[i]();
        }
        len = queue.length;
    }
    draining = false;
}
process.nextTick = function (fun) {
    queue.push(fun);
    if (!draining) {
        setTimeout(drainQueue, 0);
    }
};

process.title = 'browser';
process.browser = true;
process.env = {};
process.argv = [];
process.version = ''; // empty string to avoid regexp issues
process.versions = {};

function noop() {}

process.on = noop;
process.addListener = noop;
process.once = noop;
process.off = noop;
process.removeListener = noop;
process.removeAllListeners = noop;
process.emit = noop;

process.binding = function (name) {
    throw new Error('process.binding is not supported');
};

// TODO(shtylman)
process.cwd = function () { return '/' };
process.chdir = function (dir) {
    throw new Error('process.chdir is not supported');
};
process.umask = function() { return 0; };

},{}]},{},[2])
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3Vzci9saWIvbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2Jyb3dzZXItcGFjay9fcHJlbHVkZS5qcyIsImFmdGVyLmpzIiwiaW5kZXguanMiLCJub2RlX21vZHVsZXMvZm9yZWlnbi9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9yaWdodG8vaW5kZXguanMiLCJub2RlX21vZHVsZXMvcmlnaHRvL25vZGVfbW9kdWxlcy9hYmJvdHQvaW5kZXguanMiLCJwcm9taXNlLXBhcmFsbGVsLmpzIiwicHJvbWlzZS5qcyIsInJpZ2h0by1wYXJhbGxlbC5qcyIsInJpZ2h0by5qcyIsIi4uLy4uLy4uLy4uL3Vzci9saWIvbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL3Byb2Nlc3MvYnJvd3Nlci5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTtBQ0FBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1RBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN2QkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7OztBQzFGQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7Ozs7QUNuYUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDeEJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDekJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDekJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDekJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN2QkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSIsImZpbGUiOiJnZW5lcmF0ZWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uIGUodCxuLHIpe2Z1bmN0aW9uIHMobyx1KXtpZighbltvXSl7aWYoIXRbb10pe3ZhciBhPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7aWYoIXUmJmEpcmV0dXJuIGEobywhMCk7aWYoaSlyZXR1cm4gaShvLCEwKTt2YXIgZj1uZXcgRXJyb3IoXCJDYW5ub3QgZmluZCBtb2R1bGUgJ1wiK28rXCInXCIpO3Rocm93IGYuY29kZT1cIk1PRFVMRV9OT1RfRk9VTkRcIixmfXZhciBsPW5bb109e2V4cG9ydHM6e319O3Rbb11bMF0uY2FsbChsLmV4cG9ydHMsZnVuY3Rpb24oZSl7dmFyIG49dFtvXVsxXVtlXTtyZXR1cm4gcyhuP246ZSl9LGwsbC5leHBvcnRzLGUsdCxuLHIpfXJldHVybiBuW29dLmV4cG9ydHN9dmFyIGk9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtmb3IodmFyIG89MDtvPHIubGVuZ3RoO28rKylzKHJbb10pO3JldHVybiBzfSkiLCJtb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uKCl7XG4gICAgZnVuY3Rpb24gcnVuKGNhbGxiYWNrKXtcbiAgICAgICAgcnVuLmNvdW50Kys7XG4gICAgICAgIHNldFRpbWVvdXQoY2FsbGJhY2ssIDApO1xuICAgIH07XG5cbiAgICBydW4uY291bnQgPSAwO1xuXG4gICAgcmV0dXJuIHJ1bjtcbn07IiwidmFyIHRlc3RzID0gW1xuICAgIFsncmlnaHRvJywgcmVxdWlyZSgnLi9yaWdodG8nKV0sXG4gICAgWydwcm9taXNlJywgcmVxdWlyZSgnLi9wcm9taXNlJyldLFxuICAgIFsncmlnaHRvLXBhcmFsbGVsJywgcmVxdWlyZSgnLi9yaWdodG8tcGFyYWxsZWwnKV0sXG4gICAgWydwcm9taXNlLXBhcmFsbGVsJywgcmVxdWlyZSgnLi9wcm9taXNlLXBhcmFsbGVsJyldLFxuXG4gICAgWydyaWdodG8gcmVwZWF0JywgcmVxdWlyZSgnLi9yaWdodG8nKV0sXG4gICAgWydwcm9taXNlIHJlcGVhdCcsIHJlcXVpcmUoJy4vcHJvbWlzZScpXSxcbiAgICBbJ3JpZ2h0by1wYXJhbGxlbCByZXBlYXQnLCByZXF1aXJlKCcuL3JpZ2h0by1wYXJhbGxlbCcpXSxcbiAgICBbJ3Byb21pc2UtcGFyYWxsZWwgcmVwZWF0JywgcmVxdWlyZSgnLi9wcm9taXNlLXBhcmFsbGVsJyldXG5dO1xuXG4vLyBhdm9pZCBub2lzZSB3aXRoIG90aGVyIGxpYnNcbnZhciBzZXJpZXMgPSByZXF1aXJlKCdmb3JlaWduJykuc2VyaWVzO1xuXG5zZXRUaW1lb3V0KGZ1bmN0aW9uKCl7XG4gICAgc2VyaWVzKGZ1bmN0aW9uKHRlc3QsIGNhbGxiYWNrKXtcbiAgICAgICAgY29uc29sZS5sb2coJ1xcbicsIHRlc3RbMF0pO1xuICAgICAgICB0ZXN0WzFdKDEwMDAsIGNhbGxiYWNrKTtcbiAgICB9LCB0ZXN0cywgZnVuY3Rpb24oKXtcbiAgICAgICAgY29uc29sZS5sb2coJ2RvbmUnKTtcbiAgICB9KTtcbn0sIDUwMDApO1xuIiwiZnVuY3Rpb24gcGFyYWxsZWwoZm4sIGl0ZW1zLCBjYWxsYmFjayl7XG4gICAgaWYoIWl0ZW1zIHx8IHR5cGVvZiBpdGVtcyAhPT0gJ29iamVjdCcpe1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0l0ZW1zIG11c3QgYmUgYW4gb2JqZWN0IG9yIGFuIGFycmF5Jyk7XG4gICAgfVxuXG4gICAgdmFyIGtleXMgPSBPYmplY3Qua2V5cyhpdGVtcyksXG4gICAgICAgIGlzQXJyYXkgPSBBcnJheS5pc0FycmF5KGl0ZW1zKSxcbiAgICAgICAgbGVuZ3RoID0gaXNBcnJheSA/IGl0ZW1zLmxlbmd0aCA6IGtleXMubGVuZ3RoLFxuICAgICAgICBmaW5hbFJlc3VsdCA9IG5ldyBpdGVtcy5jb25zdHJ1Y3RvcigpLFxuICAgICAgICBkb25lID0gMCxcbiAgICAgICAgZXJyb3JlZDtcblxuICAgIGlmKGxlbmd0aCA9PT0gMCl7XG4gICAgICAgIHJldHVybiBjYWxsYmFjayhudWxsLCBmaW5hbFJlc3VsdCk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gaXNEb25lKGtleSl7XG4gICAgICAgIHJldHVybiBmdW5jdGlvbihlcnJvciwgcmVzdWx0KXtcblxuICAgICAgICAgICAgaWYoZXJyb3JlZCl7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZihlcnJvcil7XG4gICAgICAgICAgICAgICAgZXJyb3JlZCA9IHRydWU7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgZmluYWxSZXN1bHRba2V5XSA9IGFyZ3VtZW50cy5sZW5ndGggPiAyID8gQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwoYXJndW1lbnRzLCAxKSA6IHJlc3VsdDtcblxuICAgICAgICAgICAgaWYoKytkb25lID09PSBsZW5ndGgpe1xuICAgICAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGZpbmFsUmVzdWx0KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbmd0aDsgaSsrKSB7XG4gICAgICAgIHZhciBrZXkgPSBrZXlzW2ldO1xuICAgICAgICBpZihpc0FycmF5ICYmIGlzTmFOKGtleSkpe1xuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cblxuICAgICAgICBmbihpdGVtc1trZXldLCBpc0RvbmUoa2V5KSk7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBzZXJpZXMoZm4sIGl0ZW1zLCBjYWxsYmFjayl7XG4gICAgaWYoIWl0ZW1zIHx8IHR5cGVvZiBpdGVtcyAhPT0gJ29iamVjdCcpe1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0l0ZW1zIG11c3QgYmUgYW4gb2JqZWN0IG9yIGFuIGFycmF5Jyk7XG4gICAgfVxuXG4gICAgdmFyIGtleXMgPSBPYmplY3Qua2V5cyhpdGVtcyksXG4gICAgICAgIGlzQXJyYXkgPSBBcnJheS5pc0FycmF5KGl0ZW1zKSxcbiAgICAgICAgbGVuZ3RoID0gaXNBcnJheSA/IGl0ZW1zLmxlbmd0aCA6IGtleXMubGVuZ3RoLFxuICAgICAgICBmaW5hbFJlc3VsdCA9IG5ldyBpdGVtcy5jb25zdHJ1Y3RvcigpO1xuXG4gICAgaWYobGVuZ3RoID09PSAwKXtcbiAgICAgICAgcmV0dXJuIGNhbGxiYWNrKG51bGwsIGZpbmFsUmVzdWx0KTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBuZXh0KGluZGV4KXtcbiAgICAgICAgdmFyIGtleSA9IGtleXNbaW5kZXhdO1xuXG4gICAgICAgIGluZGV4Kys7XG5cbiAgICAgICAgaWYoaXNBcnJheSAmJiBpc05hTihrZXkpKXtcbiAgICAgICAgICAgIHJldHVybiBuZXh0KGluZGV4KTtcbiAgICAgICAgfVxuXG4gICAgICAgIGZuKGl0ZW1zW2tleV0sIGZ1bmN0aW9uIChlcnJvciwgcmVzdWx0KSB7XG4gICAgICAgICAgICBpZihlcnJvcil7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgZmluYWxSZXN1bHRba2V5XSA9IGFyZ3VtZW50cy5sZW5ndGggPiAyID8gQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwoYXJndW1lbnRzLCAxKSA6IHJlc3VsdDtcblxuICAgICAgICAgICAgaWYoaW5kZXggPT09IGxlbmd0aCl7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGNhbGxiYWNrKG51bGwsIGZpbmFsUmVzdWx0KTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgbmV4dChpbmRleCk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIG5leHQoMCk7XG59XG5cbm1vZHVsZS5leHBvcnRzID0ge1xuICAgIHBhcmFsbGVsOiBwYXJhbGxlbCxcbiAgICBzZXJpZXM6IHNlcmllc1xufTsiLCJ2YXIgYWJib3R0ID0gcmVxdWlyZSgnYWJib3R0Jyk7XG5cbnZhciBuZXh0VGljayA9IHByb2Nlc3MubmV4dFRpY2sgfHwgc2V0VGltZW91dDtcblxuZnVuY3Rpb24gaXNSaWdodG8oeCl7XG4gICAgcmV0dXJuIHR5cGVvZiB4ID09PSAnZnVuY3Rpb24nICYmICh4Ll9fcmVzb2x2ZV9fID09PSB4IHx8IHgucmVzb2x2ZSA9PT0geCk7XG59XG5cbmZ1bmN0aW9uIGlzVGhlbmFibGUoeCl7XG4gICAgcmV0dXJuIHggJiYgdHlwZW9mIHgudGhlbiA9PT0gJ2Z1bmN0aW9uJztcbn1cblxuZnVuY3Rpb24gaXNSZXNvbHZlYWJsZSh4KXtcbiAgICByZXR1cm4gaXNSaWdodG8oeCkgfHwgaXNUaGVuYWJsZSh4KTtcbn1cblxuZnVuY3Rpb24gaXNUYWtlKHgpe1xuICAgIHJldHVybiB4ICYmIHR5cGVvZiB4ID09PSAnb2JqZWN0JyAmJiAnX190YWtlX18nIGluIHg7XG59XG5cbnZhciBzbGljZSA9IEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsLmJpbmQoQXJyYXkucHJvdG90eXBlLnNsaWNlKTtcblxuZnVuY3Rpb24gcmVzb2x2ZURlcGVuZGVuY3kodGFzaywgZG9uZSl7XG4gICAgaWYoaXNUaGVuYWJsZSh0YXNrKSl7XG4gICAgICAgIHRhc2sgPSByaWdodG8oYWJib3R0KHRhc2spKTtcbiAgICB9XG5cbiAgICBpZihpc1JpZ2h0byh0YXNrKSl7XG4gICAgICAgIHJldHVybiB0YXNrKGZ1bmN0aW9uKGVycm9yKXtcbiAgICAgICAgICAgIHZhciByZXN1bHRzID0gc2xpY2UoYXJndW1lbnRzLCAxLCAyKTtcblxuICAgICAgICAgICAgaWYoIXJlc3VsdHMubGVuZ3RoKXtcbiAgICAgICAgICAgICAgICByZXN1bHRzLnB1c2godW5kZWZpbmVkKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgZG9uZShlcnJvciwgcmVzdWx0cyk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHRha2UodGFyZ2V0VGFzayl7XG4gICAgICAgIHZhciBrZXlzID0gc2xpY2UoYXJndW1lbnRzLCAxKTtcbiAgICAgICAgcmV0dXJuIHRhcmdldFRhc2soZnVuY3Rpb24oZXJyb3Ipe1xuICAgICAgICAgICAgdmFyIGFyZ3MgPSBzbGljZShhcmd1bWVudHMsIDEpO1xuICAgICAgICAgICAgZG9uZShlcnJvciwga2V5cy5tYXAoZnVuY3Rpb24oa2V5KXtcbiAgICAgICAgICAgICAgICByZXR1cm4gYXJnc1trZXldO1xuICAgICAgICAgICAgfSkpO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBpZihBcnJheS5pc0FycmF5KHRhc2spICYmIGlzUmlnaHRvKHRhc2tbMF0pICYmICFpc1JpZ2h0byh0YXNrWzFdKSl7XG4gICAgICAgIHJldHVybiB0YWtlLmFwcGx5KG51bGwsIHRhc2spO1xuICAgIH1cblxuICAgIGlmKGlzVGFrZSh0YXNrKSl7XG4gICAgICAgIHJldHVybiB0YWtlLmFwcGx5KG51bGwsIHRhc2suX190YWtlX18pO1xuICAgIH1cblxuICAgIHJldHVybiBkb25lKG51bGwsIFt0YXNrXSk7XG59XG5cbmZ1bmN0aW9uIGdldChmbil7XG4gICAgcmV0dXJuIHJpZ2h0byhmdW5jdGlvbihyZXN1bHQsIGZuLCBkb25lKXtcbiAgICAgICAgaWYodHlwZW9mIGZuID09PSAnc3RyaW5nJyl7XG4gICAgICAgICAgICByZXR1cm4gZG9uZShudWxsLCByZXN1bHRbZm5dKTtcbiAgICAgICAgfVxuICAgICAgICBkb25lKG51bGwsIGZuKHJlc3VsdCkpO1xuICAgIH0sIHRoaXMsIGZuKTtcbn1cblxudmFyIG5vT3AgPSBmdW5jdGlvbigpe307XG5cbmZ1bmN0aW9uIHByb3h5KGluc3RhbmNlKXtcbiAgICBpbnN0YW5jZS5fID0gbmV3IFByb3h5KGluc3RhbmNlLCB7XG4gICAgICAgIGdldDogZnVuY3Rpb24odGFyZ2V0LCBrZXkpe1xuICAgICAgICAgICAgaWYoa2V5ID09PSAnX19yZXNvbHZlX18nKXtcbiAgICAgICAgICAgICAgICByZXR1cm4gaW5zdGFuY2UuXztcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgcmV0dXJuIHByb3h5KHJpZ2h0by5zeW5jKGZ1bmN0aW9uKHJlc3VsdCl7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHJlc3VsdFtrZXldO1xuICAgICAgICAgICAgfSwgaW5zdGFuY2UpKTtcbiAgICAgICAgfVxuICAgIH0pO1xuICAgIGluc3RhbmNlLl9fcmVzb2x2ZV9fID0gaW5zdGFuY2UuXztcbiAgICByZXR1cm4gaW5zdGFuY2UuXztcbn1cblxuZnVuY3Rpb24gcmVzb2x2ZUl0ZXJhdG9yKGZuKXtcbiAgICByZXR1cm4gZnVuY3Rpb24oKXtcbiAgICAgICAgdmFyIGFyZ3MgPSBzbGljZShhcmd1bWVudHMpLFxuICAgICAgICAgICAgY2FsbGJhY2sgPSBhcmdzLnBvcCgpLFxuICAgICAgICAgICAgZXJyb3JlZCxcbiAgICAgICAgICAgIGxhc3RWYWx1ZTtcblxuICAgICAgICBmdW5jdGlvbiByZWplY3QoZXJyb3Ipe1xuICAgICAgICAgICAgaWYoZXJyb3JlZCl7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZXJyb3JlZCA9IHRydWU7XG4gICAgICAgICAgICBjYWxsYmFjayhlcnJvcik7XG4gICAgICAgIH1cblxuICAgICAgICB2YXIgZ2VuZXJhdG9yID0gZm4uYXBwbHkobnVsbCwgYXJncy5jb25jYXQocmVqZWN0KSk7XG5cbiAgICAgICAgZnVuY3Rpb24gcnVuKCl7XG4gICAgICAgICAgICBpZihlcnJvcmVkKXtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB2YXIgbmV4dCA9IGdlbmVyYXRvci5uZXh0KGxhc3RWYWx1ZSk7XG4gICAgICAgICAgICBpZihuZXh0LmRvbmUpe1xuICAgICAgICAgICAgICAgIGlmKGVycm9yZWQpe1xuICAgICAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHJldHVybiBjYWxsYmFjayhudWxsLCBuZXh0LnZhbHVlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmKGlzUmVzb2x2ZWFibGUobmV4dC52YWx1ZSkpe1xuICAgICAgICAgICAgICAgIHJpZ2h0by5zeW5jKGZ1bmN0aW9uKHZhbHVlKXtcbiAgICAgICAgICAgICAgICAgICAgbGFzdFZhbHVlID0gdmFsdWU7XG4gICAgICAgICAgICAgICAgICAgIHJ1bigpO1xuICAgICAgICAgICAgICAgIH0sIG5leHQudmFsdWUpKGZ1bmN0aW9uKGVycm9yKXtcbiAgICAgICAgICAgICAgICAgICAgaWYoZXJyb3Ipe1xuICAgICAgICAgICAgICAgICAgICAgICAgcmVqZWN0KGVycm9yKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGxhc3RWYWx1ZSA9IG5leHQudmFsdWU7XG4gICAgICAgICAgICBydW4oKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJ1bigpO1xuICAgIH07XG59XG5cbmZ1bmN0aW9uIGFkZFRyYWNpbmcocmVzb2x2ZSwgZm4sIGFyZ3Mpe1xuICAgIGZ1bmN0aW9uIGdldENhbGxMaW5lKHN0YWNrKXtcbiAgICAgICAgcmV0dXJuIHN0YWNrLnNwbGl0KCdcXG4nKVszXS5tYXRjaCgvYXQgKC4qKS8pWzFdO1xuICAgIH1cblxuICAgIHZhciBhcmdNYXRjaCA9IGZuLnRvU3RyaW5nKCkubWF0Y2goL15bXFx3XFxzXSo/XFwoKCg/OlxcdytbLFxcc10qPykqKVxcKS8pLFxuICAgICAgICBhcmdOYW1lcyA9IGFyZ01hdGNoID8gYXJnTWF0Y2hbMV0uc3BsaXQoL1ssXFxzXSsvZykgOiBbXTtcblxuICAgIHJlc29sdmUuX3N0YWNrID0gbmV3IEVycm9yKCkuc3RhY2s7XG4gICAgcmVzb2x2ZS5fdHJhY2UgPSBmdW5jdGlvbih0YWJzKXtcbiAgICAgICAgdGFicyA9IHRhYnMgfHwgMDtcbiAgICAgICAgdmFyIHNwYWNpbmcgPSAnICAgICc7XG4gICAgICAgIGZvcih2YXIgaSA9IDA7IGkgPCB0YWJzOyBpICsrKXtcbiAgICAgICAgICAgIHNwYWNpbmcgPSBzcGFjaW5nICsgJyAgICAnO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBhcmdzLm1hcChmdW5jdGlvbihhcmcsIGluZGV4KXtcbiAgICAgICAgICAgIHJldHVybiBbYXJnLCBhcmdOYW1lc1tpbmRleF0gfHwgaW5kZXhdO1xuICAgICAgICB9KS5yZWR1Y2UoZnVuY3Rpb24ocmVzdWx0cywgYXJnSW5mbyl7XG4gICAgICAgICAgICB2YXIgYXJnID0gYXJnSW5mb1swXSxcbiAgICAgICAgICAgICAgICBhcmdOYW1lID0gYXJnSW5mb1sxXTtcblxuICAgICAgICAgICAgaWYoaXNUYWtlKGFyZykpe1xuICAgICAgICAgICAgICAgIGFyZyA9IGFyZy5fX3Rha2VfX1swXTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYoaXNSaWdodG8oYXJnKSl7XG4gICAgICAgICAgICAgICAgdmFyIGxpbmUgPSBzcGFjaW5nICsgJy0gYXJndW1lbnQgXCInICsgYXJnTmFtZSArICdcIiBmcm9tICc7XG4gICAgICAgICAgICAgICAgaWYoIWFyZy5fdHJhY2Upe1xuICAgICAgICAgICAgICAgICAgICByZXN1bHRzLnB1c2gobGluZSArICdUcmFjaW5nIHdhcyBub3QgZW5hYmxlZCBmb3IgdGhpcyByaWdodG8gaW5zdGFuY2UuJyk7XG4gICAgICAgICAgICAgICAgfWVsc2V7XG4gICAgICAgICAgICAgICAgICAgIHJlc3VsdHMucHVzaChsaW5lICsgYXJnLl90cmFjZSh0YWJzICsgMSkpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgcmV0dXJuIHJlc3VsdHM7XG4gICAgICAgIH0sIFtnZXRDYWxsTGluZShyZXNvbHZlLl9zdGFjayldKVxuICAgICAgICAuam9pbignXFxuJyk7XG4gICAgfTtcbn1cblxuZnVuY3Rpb24gdGFza0NvbXBsZXRlKCl7XG4gICAgdmFyIGNvbnRleHQgPSB0aGlzWzJdLFxuICAgICAgICByZXN1bHRzID0gYXJndW1lbnRzO1xuICAgIHRoaXNbMF0ocmVzdWx0cyk7XG4gICAgdGhpc1sxXS5mb3JFYWNoKGZ1bmN0aW9uKGNhbGxiYWNrKXtcbiAgICAgICAgY2FsbGJhY2suYXBwbHkoY29udGV4dCwgcmVzdWx0cyk7XG4gICAgfSk7XG59XG5cbmZ1bmN0aW9uIGVycm9yT3V0KGNhbGxiYWNrKXtcbiAgICBjYWxsYmFjayh0aGlzWzBdKTtcbn1cblxuZnVuY3Rpb24gcmVzb2x2ZVdpdGhEZXBlbmRlbmNpZXMoZG9uZSwgZXJyb3IsIGFyZ1Jlc3VsdHMpe1xuICAgIHZhciBmbiA9IHRoaXNbMF0sXG4gICAgICAgIGNhbGxiYWNrcyA9IHRoaXNbMV0sXG4gICAgICAgIGNvbnRleHQgPSB0aGlzWzJdO1xuXG4gICAgaWYoZXJyb3Ipe1xuICAgICAgICByZXR1cm4gY2FsbGJhY2tzLmZvckVhY2goZXJyb3JPdXQuYmluZChbZXJyb3JdKSk7XG4gICAgfVxuXG4gICAgdmFyIGFyZ3MgPSBbXS5jb25jYXQuYXBwbHkoW10sIGFyZ1Jlc3VsdHMpO1xuXG4gICAgYXJncy5wdXNoKHRhc2tDb21wbGV0ZS5iaW5kKFtkb25lLCBjYWxsYmFja3MsIGNvbnRleHRdKSk7XG5cbiAgICBmbi5hcHBseShudWxsLCBhcmdzKTtcbn1cblxuZnVuY3Rpb24gcmVzb2x2ZURlcGVuZGVuY2llcyhhcmdzLCBjb21wbGV0ZSwgcmVzb2x2ZURlcGVuZGVuY3kpe1xuICAgIHZhciByZXN1bHRzID0gW10sXG4gICAgICAgIGRvbmUgPSAwLFxuICAgICAgICBoYXNFcnJvcmVkO1xuXG4gICAgaWYoIWFyZ3MubGVuZ3RoKXtcbiAgICAgICAgY29tcGxldGUobnVsbCwgW10pO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGRlcGVuZGVuY3lSZXNvbHZlZChpbmRleCwgZXJyb3IsIHJlc3VsdCl7XG4gICAgICAgIGlmKGhhc0Vycm9yZWQpe1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYoZXJyb3Ipe1xuICAgICAgICAgICAgaGFzRXJyb3JlZCA9IHRydWU7XG4gICAgICAgICAgICByZXR1cm4gY29tcGxldGUoZXJyb3IpO1xuICAgICAgICB9XG5cbiAgICAgICAgcmVzdWx0c1tpbmRleF0gPSByZXN1bHQ7XG5cbiAgICAgICAgaWYoKytkb25lID09PSBhcmdzLmxlbmd0aCl7XG4gICAgICAgICAgICBjb21wbGV0ZShudWxsLCByZXN1bHRzKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGFyZ3MuZm9yRWFjaChmdW5jdGlvbihhcmcsIGluZGV4KXtcbiAgICAgICAgcmVzb2x2ZURlcGVuZGVuY3koYXJnLCBkZXBlbmRlbmN5UmVzb2x2ZWQuYmluZChudWxsLCBpbmRleCkpO1xuICAgIH0pO1xufVxuXG5mdW5jdGlvbiByaWdodG8oZm4pe1xuICAgIHZhciBhcmdzID0gc2xpY2UoYXJndW1lbnRzKSxcbiAgICAgICAgZm4gPSBhcmdzLnNoaWZ0KCksXG4gICAgICAgIGNvbnRleHQgPSB0aGlzLFxuICAgICAgICBzdGFydGVkID0gMCxcbiAgICAgICAgY2FsbGJhY2tzID0gW10sXG4gICAgICAgIHJlc3VsdHM7XG5cblxuICAgIGlmKHR5cGVvZiBmbiAhPT0gJ2Z1bmN0aW9uJyl7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcignTm8gdGFzayBmdW5jdGlvbiBwYXNzZWQgdG8gcmlnaHRvJyk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gcmVzb2x2ZShjYWxsYmFjayl7XG5cbiAgICAgICAgLy8gTm8gY2FsbGJhY2s/IEp1c3QgcnVuIHRoZSB0YXNrLlxuICAgICAgICBpZighYXJndW1lbnRzLmxlbmd0aCl7XG4gICAgICAgICAgICBjYWxsYmFjayA9IG5vT3A7XG4gICAgICAgIH1cblxuICAgICAgICBpZih0eXBlb2YgY2FsbGJhY2sgIT09ICdmdW5jdGlvbicpe1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdDYWxsYmFjayBtdXN0IGJlIGEgZnVuY3Rpb24nKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmKHJlc3VsdHMpe1xuICAgICAgICAgICAgcmV0dXJuIGNhbGxiYWNrLmFwcGx5KGNvbnRleHQsIHJlc3VsdHMpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYocmlnaHRvLl9kZWJ1Zyl7XG4gICAgICAgICAgICBpZihyaWdodG8uX2F1dG90cmFjZSB8fCByZXNvbHZlLl90cmFjZU9uRXhlY3V0ZSl7XG4gICAgICAgICAgICAgICAgY29uc29sZS5sb2coJ0V4ZWN1dGluZyAnICsgZm4ubmFtZSArICcgJyArIHJlc29sdmUuX3RyYWNlKCkpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgY2FsbGJhY2tzLnB1c2goY2FsbGJhY2spO1xuXG4gICAgICAgIGlmKHN0YXJ0ZWQrKyl7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICB2YXIgY29tcGxldGUgPSByZXNvbHZlV2l0aERlcGVuZGVuY2llcy5iaW5kKFtmbiwgY2FsbGJhY2tzLCBjb250ZXh0XSwgZnVuY3Rpb24ocmVzb2x2ZWRSZXN1bHRzKXtcbiAgICAgICAgICAgICAgICByZXN1bHRzID0gcmVzb2x2ZWRSZXN1bHRzO1xuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgbmV4dFRpY2socmVzb2x2ZURlcGVuZGVuY2llcy5iaW5kKG51bGwsIGFyZ3MsIGNvbXBsZXRlLCByZXNvbHZlRGVwZW5kZW5jeSkpO1xuICAgIH07XG5cbiAgICByZXNvbHZlLmdldCA9IGdldC5iaW5kKHJlc29sdmUpO1xuICAgIHJlc29sdmUucmVzb2x2ZSA9IHJlc29sdmU7XG5cbiAgICBpZihyaWdodG8uX2RlYnVnKXtcbiAgICAgICAgYWRkVHJhY2luZyhyZXNvbHZlLCBmbiwgYXJncyk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHJlc29sdmU7XG59XG5cbnJpZ2h0by5zeW5jID0gZnVuY3Rpb24oZm4pe1xuICAgIHJldHVybiByaWdodG8uYXBwbHkobnVsbCwgW2Z1bmN0aW9uKCl7XG4gICAgICAgIHZhciBhcmdzID0gc2xpY2UoYXJndW1lbnRzKSxcbiAgICAgICAgICAgIGRvbmUgPSBhcmdzLnBvcCgpO1xuXG4gICAgICAgIG5leHRUaWNrKGZ1bmN0aW9uKCl7XG4gICAgICAgICAgICBkb25lKG51bGwsIGZuLmFwcGx5KG51bGwsIGFyZ3MpKTtcbiAgICAgICAgfSk7XG4gICAgfV0uY29uY2F0KHNsaWNlKGFyZ3VtZW50cywgMSkpKTtcbn07XG5cbnJpZ2h0by5hbGwgPSBmdW5jdGlvbih0YXNrKXtcbiAgICBpZihhcmd1bWVudHMubGVuZ3RoID4gMSl7XG4gICAgICAgIHRhc2sgPSBzbGljZShhcmd1bWVudHMpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHJlc29sdmUodGFza3Mpe1xuICAgICAgICByZXR1cm4gcmlnaHRvLmFwcGx5KG51bGwsIFtmdW5jdGlvbigpe1xuICAgICAgICAgICAgYXJndW1lbnRzW2FyZ3VtZW50cy5sZW5ndGggLSAxXShudWxsLCBzbGljZShhcmd1bWVudHMsIDAsIC0xKSk7XG4gICAgICAgIH1dLmNvbmNhdCh0YXNrcykpO1xuICAgIH1cblxuICAgIGlmKGlzUmlnaHRvKHRhc2spKXtcbiAgICAgICAgcmV0dXJuIHJpZ2h0byhmdW5jdGlvbih0YXNrcywgZG9uZSl7XG4gICAgICAgICAgICByZXNvbHZlKHRhc2tzKShkb25lKTtcbiAgICAgICAgfSwgdGFzayk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHJlc29sdmUodGFzayk7XG59O1xuXG5yaWdodG8uZnJvbSA9IGZ1bmN0aW9uKHZhbHVlKXtcbiAgICBpZihpc1JpZ2h0byh2YWx1ZSkpe1xuICAgICAgICByZXR1cm4gdmFsdWU7XG4gICAgfVxuXG4gICAgcmV0dXJuIHJpZ2h0by5zeW5jKGZ1bmN0aW9uKHJlc29sdmVkKXtcbiAgICAgICAgcmV0dXJuIHJlc29sdmVkO1xuICAgIH0sIHZhbHVlKTtcbn07XG5cbnJpZ2h0by5tYXRlID0gZnVuY3Rpb24oKXtcbiAgICByZXR1cm4gcmlnaHRvLmFwcGx5KG51bGwsIFtmdW5jdGlvbigpe1xuICAgICAgICBhcmd1bWVudHNbYXJndW1lbnRzLmxlbmd0aCAtMV0uYXBwbHkobnVsbCwgW251bGxdLmNvbmNhdChzbGljZShhcmd1bWVudHMsIDAsIC0xKSkpO1xuICAgIH1dLmNvbmNhdChzbGljZShhcmd1bWVudHMpKSk7XG59O1xuXG5yaWdodG8udGFrZSA9IGZ1bmN0aW9uKCl7XG4gICAgcmV0dXJuIHtfX3Rha2VfXzogc2xpY2UoYXJndW1lbnRzKX07XG59O1xuXG5yaWdodG8uYWZ0ZXIgPSBmdW5jdGlvbih0YXNrKXtcbiAgICBpZihhcmd1bWVudHMubGVuZ3RoID09PSAxKXtcbiAgICAgICAgcmV0dXJuIHtfX3Rha2VfXzogW3Rhc2tdfTtcbiAgICB9XG5cbiAgICByZXR1cm4ge19fdGFrZV9fOiBbcmlnaHRvLm1hdGUuYXBwbHkobnVsbCwgYXJndW1lbnRzKV19O1xufTtcblxucmlnaHRvLnJlc29sdmUgPSBmdW5jdGlvbihvYmplY3QsIGRlZXApe1xuICAgIGlmKGlzUmlnaHRvKG9iamVjdCkpe1xuICAgICAgICByZXR1cm4gcmlnaHRvLnN5bmMoZnVuY3Rpb24ob2JqZWN0KXtcbiAgICAgICAgICAgIHJldHVybiByaWdodG8ucmVzb2x2ZShvYmplY3QsIGRlZXApO1xuICAgICAgICB9LCBvYmplY3QpO1xuICAgIH1cblxuICAgIGlmKCFvYmplY3QgfHwgISh0eXBlb2Ygb2JqZWN0ID09PSAnb2JqZWN0JyB8fCB0eXBlb2Ygb2JqZWN0ID09PSAnZnVuY3Rpb24nKSl7XG4gICAgICAgIHJldHVybiByaWdodG8uZnJvbShvYmplY3QpO1xuICAgIH1cblxuICAgIHZhciBwYWlycyA9IHJpZ2h0by5hbGwoT2JqZWN0LmtleXMob2JqZWN0KS5tYXAoZnVuY3Rpb24oa2V5KXtcbiAgICAgICAgcmV0dXJuIHJpZ2h0byhmdW5jdGlvbih2YWx1ZSwgZG9uZSl7XG4gICAgICAgICAgICBpZihkZWVwKXtcbiAgICAgICAgICAgICAgICByaWdodG8uc3luYyhmdW5jdGlvbih2YWx1ZSl7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBba2V5LCB2YWx1ZV07XG4gICAgICAgICAgICAgICAgfSwgcmlnaHRvLnJlc29sdmUodmFsdWUsIHRydWUpKShkb25lKTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBkb25lKG51bGwsIFtrZXksIHZhbHVlXSk7XG4gICAgICAgIH0sIG9iamVjdFtrZXldKTtcbiAgICB9KSk7XG5cbiAgICByZXR1cm4gcmlnaHRvLnN5bmMoZnVuY3Rpb24ocGFpcnMpe1xuICAgICAgICByZXR1cm4gcGFpcnMucmVkdWNlKGZ1bmN0aW9uKHJlc3VsdCwgcGFpcil7XG4gICAgICAgICAgICByZXN1bHRbcGFpclswXV0gPSBwYWlyWzFdO1xuICAgICAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICAgICAgfSwge30pO1xuICAgIH0sIHBhaXJzKTtcbn07XG5cbnJpZ2h0by5pdGVyYXRlID0gZnVuY3Rpb24oKXtcbiAgICB2YXIgYXJncyA9IHNsaWNlKGFyZ3VtZW50cyksXG4gICAgICAgIGZuID0gYXJncy5zaGlmdCgpO1xuXG4gICAgcmV0dXJuIHJpZ2h0by5hcHBseShudWxsLCBbcmVzb2x2ZUl0ZXJhdG9yKGZuKV0uY29uY2F0KGFyZ3MpKTtcbn07XG5cbnJpZ2h0by52YWx1ZSA9IGZ1bmN0aW9uKCl7XG4gICAgdmFyIGFyZ3MgPSBhcmd1bWVudHM7XG4gICAgcmV0dXJuIHJpZ2h0byhmdW5jdGlvbihkb25lKXtcbiAgICAgICAgZG9uZS5hcHBseShudWxsLCBbbnVsbF0uY29uY2F0KHNsaWNlKGFyZ3MpKSk7XG4gICAgfSk7XG59O1xuXG5yaWdodG8uc3VyZWx5ID0gZnVuY3Rpb24odGFzayl7XG4gICAgaWYoIWlzUmVzb2x2ZWFibGUodGFzaykpe1xuICAgICAgICB0YXNrID0gcmlnaHRvLmFwcGx5KG51bGwsIGFyZ3VtZW50cyk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHJpZ2h0byhmdW5jdGlvbihkb25lKXtcbiAgICAgICAgdGFzayhmdW5jdGlvbigpe1xuICAgICAgICAgICAgZG9uZShudWxsLCBzbGljZShhcmd1bWVudHMpKTtcbiAgICAgICAgfSk7XG4gICAgfSk7XG59O1xuXG5yaWdodG8ucHJveHkgPSBmdW5jdGlvbigpe1xuICAgIGlmKHR5cGVvZiBQcm94eSA9PT0gJ3VuZGVmaW5lZCcpe1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1RoaXMgZW52aXJvbm1lbnQgZG9lcyBub3Qgc3VwcG9ydCBQcm94eVxcJ3MnKTtcbiAgICB9XG5cbiAgICByZXR1cm4gcHJveHkocmlnaHRvLmFwcGx5KHRoaXMsIGFyZ3VtZW50cykpO1xufTtcblxuZm9yKHZhciBrZXkgaW4gcmlnaHRvKXtcbiAgICByaWdodG8ucHJveHlba2V5XSA9IHJpZ2h0b1trZXldO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHJpZ2h0bzsiLCJmdW5jdGlvbiBjaGVja0lmUHJvbWlzZShwcm9taXNlKXtcbiAgICBpZighcHJvbWlzZSB8fCB0eXBlb2YgcHJvbWlzZSAhPT0gJ29iamVjdCcgfHwgdHlwZW9mIHByb21pc2UudGhlbiAhPT0gJ2Z1bmN0aW9uJyl7XG4gICAgICAgIHRocm93IFwiQWJib3R0IHJlcXVpcmVzIGEgcHJvbWlzZSB0byBicmVhay4gSXQgaXMgdGhlIG9ubHkgdGhpbmcgQWJib3R0IGlzIGdvb2QgYXQuXCI7XG4gICAgfVxufVxuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIGFiYm90dChwcm9taXNlT3JGbil7XG4gICAgaWYodHlwZW9mIHByb21pc2VPckZuICE9PSAnZnVuY3Rpb24nKXtcbiAgICAgICAgY2hlY2tJZlByb21pc2UocHJvbWlzZU9yRm4pO1xuICAgIH1cblxuICAgIHJldHVybiBmdW5jdGlvbigpe1xuICAgICAgICB2YXIgcHJvbWlzZTtcbiAgICAgICAgaWYodHlwZW9mIHByb21pc2VPckZuID09PSAnZnVuY3Rpb24nKXtcbiAgICAgICAgICAgcHJvbWlzZSA9IHByb21pc2VPckZuLmFwcGx5KG51bGwsIEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGFyZ3VtZW50cywgMCwgLTEpKTtcbiAgICAgICAgfWVsc2V7XG4gICAgICAgICAgICBwcm9taXNlID0gcHJvbWlzZU9yRm47XG4gICAgICAgIH1cblxuICAgICAgICBjaGVja0lmUHJvbWlzZShwcm9taXNlKTtcblxuICAgICAgICB2YXIgY2FsbGJhY2sgPSBhcmd1bWVudHNbYXJndW1lbnRzLmxlbmd0aC0xXTtcbiAgICAgICAgcHJvbWlzZS50aGVuKGNhbGxiYWNrLmJpbmQobnVsbCwgbnVsbCksIGNhbGxiYWNrKTtcbiAgICB9O1xufTsiLCJ2YXIgcmlnaHRvID0gcmVxdWlyZSgncmlnaHRvJyksXG4gICAgYWZ0ZXIgPSByZXF1aXJlKCcuL2FmdGVyJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24oaXRlcmF0aW9ucywgY2FsbGJhY2spe1xuICAgIHZhciBjb3VudGVyID0gYWZ0ZXIoKSxcbiAgICAgICAgaW5pdFN0YXJ0ID0gRGF0ZS5ub3coKTtcblxuICAgIHZhciB0YXNrcyA9IFtdO1xuXG4gICAgZm9yKHZhciBpID0gMDsgaSA8IGl0ZXJhdGlvbnM7IGkrKyl7XG4gICAgICAgIHRhc2tzLnB1c2gobmV3IFByb21pc2UoY291bnRlcikpO1xuICAgIH1cblxuICAgIHZhciBkb0FsbCA9IFByb21pc2UuYWxsKHRhc2tzKTtcblxuICAgIHZhciBleGVjdXRlU3RhcnQgPSBEYXRlLm5vdygpO1xuICAgIGNvbnNvbGUubG9nKCdpbml0IHRpbWU6ICcsIGV4ZWN1dGVTdGFydCAtIGluaXRTdGFydCk7XG5cbiAgICBkb0FsbC50aGVuKGZ1bmN0aW9uKCl7XG4gICAgICAgIGNvbnNvbGUubG9nKGNvdW50ZXIuY291bnQpO1xuICAgICAgICB2YXIgY29tcGxldGVkVGltZSA9IERhdGUubm93KCk7XG4gICAgICAgIGNvbnNvbGUubG9nKCdleGVjdXRlIHRpbWU6ICcsIGNvbXBsZXRlZFRpbWUgLSBleGVjdXRlU3RhcnQpO1xuICAgICAgICBjb25zb2xlLmxvZygndG90YWwgdGltZTogJywgY29tcGxldGVkVGltZSAtIGluaXRTdGFydCk7XG4gICAgICAgIGNhbGxiYWNrKCk7XG4gICAgfSk7XG59IiwidmFyIHJpZ2h0byA9IHJlcXVpcmUoJ3JpZ2h0bycpLFxuICAgIGFmdGVyID0gcmVxdWlyZSgnLi9hZnRlcicpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uKGl0ZXJhdGlvbnMsIGNhbGxiYWNrKXtcbiAgICB2YXIgY291bnRlciA9IGFmdGVyKCksXG4gICAgICAgIGluaXRTdGFydCA9IERhdGUubm93KCk7XG5cbiAgICB2YXIgbGFzdCA9IG5ldyBQcm9taXNlKGNvdW50ZXIpO1xuXG4gICAgZm9yKHZhciBpID0gMDsgaSA8IGl0ZXJhdGlvbnM7IGkrKyl7XG4gICAgICAgIGxhc3QgPSBsYXN0LnRoZW4oZnVuY3Rpb24oKXtcbiAgICAgICAgICAgIHJldHVybiBuZXcgUHJvbWlzZShjb3VudGVyKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgdmFyIGV4ZWN1dGVTdGFydCA9IERhdGUubm93KCk7XG4gICAgY29uc29sZS5sb2coJ2luaXQgdGltZTogJywgZXhlY3V0ZVN0YXJ0IC0gaW5pdFN0YXJ0KTtcblxuICAgIGxhc3QudGhlbihmdW5jdGlvbigpe1xuICAgICAgICBjb25zb2xlLmxvZyhjb3VudGVyLmNvdW50KTtcbiAgICAgICAgdmFyIGNvbXBsZXRlZFRpbWUgPSBEYXRlLm5vdygpO1xuICAgICAgICBjb25zb2xlLmxvZygnZXhlY3V0ZSB0aW1lOiAnLCBjb21wbGV0ZWRUaW1lIC0gZXhlY3V0ZVN0YXJ0KTtcbiAgICAgICAgY29uc29sZS5sb2coJ3RvdGFsIHRpbWU6ICcsIGNvbXBsZXRlZFRpbWUgLSBpbml0U3RhcnQpO1xuICAgICAgICBjYWxsYmFjaygpO1xuICAgIH0pO1xufTsiLCJ2YXIgcmlnaHRvID0gcmVxdWlyZSgncmlnaHRvJyksXG4gICAgYWZ0ZXIgPSByZXF1aXJlKCcuL2FmdGVyJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24oaXRlcmF0aW9ucywgY2FsbGJhY2spe1xuICAgIHZhciBjb3VudGVyID0gYWZ0ZXIoKSxcbiAgICAgICAgaW5pdFN0YXJ0ID0gRGF0ZS5ub3coKTtcblxuICAgIHZhciB0YXNrcyA9IFtdO1xuXG4gICAgZm9yKHZhciBpID0gMDsgaSA8IGl0ZXJhdGlvbnM7IGkrKyl7XG4gICAgICAgIHRhc2tzLnB1c2gocmlnaHRvKGNvdW50ZXIpKTtcbiAgICB9XG5cbiAgICB2YXIgZG9BbGwgPSByaWdodG8uYWxsKHRhc2tzKTtcblxuICAgIHZhciBleGVjdXRlU3RhcnQgPSBEYXRlLm5vdygpO1xuICAgIGNvbnNvbGUubG9nKCdpbml0IHRpbWU6ICcsIGV4ZWN1dGVTdGFydCAtIGluaXRTdGFydCk7XG5cbiAgICBkb0FsbChmdW5jdGlvbigpe1xuICAgICAgICBjb25zb2xlLmxvZyhjb3VudGVyLmNvdW50KTtcbiAgICAgICAgdmFyIGNvbXBsZXRlZFRpbWUgPSBEYXRlLm5vdygpO1xuICAgICAgICBjb25zb2xlLmxvZygnZXhlY3V0ZSB0aW1lOiAnLCBjb21wbGV0ZWRUaW1lIC0gZXhlY3V0ZVN0YXJ0KTtcbiAgICAgICAgY29uc29sZS5sb2coJ3RvdGFsIHRpbWU6ICcsIGNvbXBsZXRlZFRpbWUgLSBpbml0U3RhcnQpO1xuICAgICAgICBjYWxsYmFjaygpO1xuICAgIH0pO1xufSIsInZhciByaWdodG8gPSByZXF1aXJlKCdyaWdodG8nKSxcbiAgICBhZnRlciA9IHJlcXVpcmUoJy4vYWZ0ZXInKTtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbihpdGVyYXRpb25zLCBjYWxsYmFjayl7XG4gICAgdmFyIGNvdW50ZXIgPSBhZnRlcigpLFxuICAgICAgICBpbml0U3RhcnQgPSBEYXRlLm5vdygpO1xuXG4gICAgdmFyIGxhc3QgPSByaWdodG8oY291bnRlcik7XG5cbiAgICBmb3IodmFyIGkgPSAwOyBpIDwgaXRlcmF0aW9uczsgaSsrKXtcbiAgICAgICAgbGFzdCA9IHJpZ2h0byhjb3VudGVyLCByaWdodG8uYWZ0ZXIobGFzdCkpO1xuICAgIH1cblxuICAgIHZhciBleGVjdXRlU3RhcnQgPSBEYXRlLm5vdygpO1xuICAgIGNvbnNvbGUubG9nKCdpbml0IHRpbWU6ICcsIGV4ZWN1dGVTdGFydCAtIGluaXRTdGFydCk7XG5cbiAgICBsYXN0KGZ1bmN0aW9uKCl7XG4gICAgICAgIGNvbnNvbGUubG9nKGNvdW50ZXIuY291bnQpO1xuICAgICAgICB2YXIgY29tcGxldGVkVGltZSA9IERhdGUubm93KCk7XG4gICAgICAgIGNvbnNvbGUubG9nKCdleGVjdXRlIHRpbWU6ICcsIGNvbXBsZXRlZFRpbWUgLSBleGVjdXRlU3RhcnQpO1xuICAgICAgICBjb25zb2xlLmxvZygndG90YWwgdGltZTogJywgY29tcGxldGVkVGltZSAtIGluaXRTdGFydCk7XG4gICAgICAgIGNhbGxiYWNrKCk7XG4gICAgfSk7XG59IiwiLy8gc2hpbSBmb3IgdXNpbmcgcHJvY2VzcyBpbiBicm93c2VyXG5cbnZhciBwcm9jZXNzID0gbW9kdWxlLmV4cG9ydHMgPSB7fTtcbnZhciBxdWV1ZSA9IFtdO1xudmFyIGRyYWluaW5nID0gZmFsc2U7XG5cbmZ1bmN0aW9uIGRyYWluUXVldWUoKSB7XG4gICAgaWYgKGRyYWluaW5nKSB7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG4gICAgZHJhaW5pbmcgPSB0cnVlO1xuICAgIHZhciBjdXJyZW50UXVldWU7XG4gICAgdmFyIGxlbiA9IHF1ZXVlLmxlbmd0aDtcbiAgICB3aGlsZShsZW4pIHtcbiAgICAgICAgY3VycmVudFF1ZXVlID0gcXVldWU7XG4gICAgICAgIHF1ZXVlID0gW107XG4gICAgICAgIHZhciBpID0gLTE7XG4gICAgICAgIHdoaWxlICgrK2kgPCBsZW4pIHtcbiAgICAgICAgICAgIGN1cnJlbnRRdWV1ZVtpXSgpO1xuICAgICAgICB9XG4gICAgICAgIGxlbiA9IHF1ZXVlLmxlbmd0aDtcbiAgICB9XG4gICAgZHJhaW5pbmcgPSBmYWxzZTtcbn1cbnByb2Nlc3MubmV4dFRpY2sgPSBmdW5jdGlvbiAoZnVuKSB7XG4gICAgcXVldWUucHVzaChmdW4pO1xuICAgIGlmICghZHJhaW5pbmcpIHtcbiAgICAgICAgc2V0VGltZW91dChkcmFpblF1ZXVlLCAwKTtcbiAgICB9XG59O1xuXG5wcm9jZXNzLnRpdGxlID0gJ2Jyb3dzZXInO1xucHJvY2Vzcy5icm93c2VyID0gdHJ1ZTtcbnByb2Nlc3MuZW52ID0ge307XG5wcm9jZXNzLmFyZ3YgPSBbXTtcbnByb2Nlc3MudmVyc2lvbiA9ICcnOyAvLyBlbXB0eSBzdHJpbmcgdG8gYXZvaWQgcmVnZXhwIGlzc3Vlc1xucHJvY2Vzcy52ZXJzaW9ucyA9IHt9O1xuXG5mdW5jdGlvbiBub29wKCkge31cblxucHJvY2Vzcy5vbiA9IG5vb3A7XG5wcm9jZXNzLmFkZExpc3RlbmVyID0gbm9vcDtcbnByb2Nlc3Mub25jZSA9IG5vb3A7XG5wcm9jZXNzLm9mZiA9IG5vb3A7XG5wcm9jZXNzLnJlbW92ZUxpc3RlbmVyID0gbm9vcDtcbnByb2Nlc3MucmVtb3ZlQWxsTGlzdGVuZXJzID0gbm9vcDtcbnByb2Nlc3MuZW1pdCA9IG5vb3A7XG5cbnByb2Nlc3MuYmluZGluZyA9IGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdwcm9jZXNzLmJpbmRpbmcgaXMgbm90IHN1cHBvcnRlZCcpO1xufTtcblxuLy8gVE9ETyhzaHR5bG1hbilcbnByb2Nlc3MuY3dkID0gZnVuY3Rpb24gKCkgeyByZXR1cm4gJy8nIH07XG5wcm9jZXNzLmNoZGlyID0gZnVuY3Rpb24gKGRpcikge1xuICAgIHRocm93IG5ldyBFcnJvcigncHJvY2Vzcy5jaGRpciBpcyBub3Qgc3VwcG9ydGVkJyk7XG59O1xucHJvY2Vzcy51bWFzayA9IGZ1bmN0aW9uKCkgeyByZXR1cm4gMDsgfTtcbiJdfQ==
