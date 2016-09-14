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