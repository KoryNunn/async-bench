var wait = typeof setImmediate ? setImmediate : nextTick;

module.exports = function(){
    function run(callback){
        run.count++;
        wait(callback);
    };

    run.count = 0;

    return run;
};