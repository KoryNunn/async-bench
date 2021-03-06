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
    var initTime = (executeStart - initStart);

    doAll.then(function(){

        var completedTime = Date.now();
        var executeTime = (completedTime - executeStart);

        callback(null, {initTime, executeTime})
    });
}