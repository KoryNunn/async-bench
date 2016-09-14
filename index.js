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
