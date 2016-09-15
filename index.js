var tests = [
    ['righto', require('./righto')],
    ['promise', require('./promise')],
    ['righto-parallel', require('./righto-parallel')],
    ['promise-parallel', require('./promise-parallel')],
    ['righto-muti-dep', require('./righto-muti-dep')],
    ['promise-multi-dep', require('./promise-multi-dep')],

    ['righto repeat', require('./righto')],
    ['promise repeat', require('./promise')],
    ['righto-parallel repeat', require('./righto-parallel')],
    ['promise-parallel repeat', require('./promise-parallel')],
    ['righto-muti-dep repeat', require('./righto-muti-dep')],
    ['promise-multi-dep repeat', require('./promise-multi-dep')]
];

// avoid noise with other libs
var series = require('foreign').series,
    table = require('console.table'),
    iterations = 10000,
    results = [];

console.log('running ' + iterations + ' iterations of each test...');

series(function(test, callback){
    test[1](iterations, function(error, result){
        result.name = test[0];
        results.push({
            name: test[0],
            initTime: result.initTime,
            executeTime: result.executeTime
        });
        callback();
    });
}, tests, function(){
    console.table(results);
    console.log('done');
});
