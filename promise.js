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