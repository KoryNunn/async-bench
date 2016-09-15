var righto = require('righto'),
    after = require('./after');

module.exports = function(iterations, callback){
    var counter = after(),
        initStart = Date.now();

    var last = new Promise(counter);

    for(var i = 0; i < iterations; i++){
        var a = last.then(function(){
                return new Promise(counter);
            });
        var b = last.then(function(){
                return new Promise(counter);
            });
        var c = last.then(function(){
                return new Promise(counter);
            });

        last = Promise.all([a,b,c]);
    }

    var executeStart = Date.now();
    var initTime = (executeStart - initStart);

    last.then(function(){

        var completedTime = Date.now();
        var executeTime = (completedTime - executeStart);

        callback(null, {initTime, executeTime})
    });
}