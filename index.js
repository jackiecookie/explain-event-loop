const CONSOLELOG = 1;
const SETTIMEOUT = 2;
const THEN = 3;
const UNKNOW = 0;
const FUNCTION = 4;
const AWAITFUNCTION = 5;

// stack types
const MICROTASKS = 6;
const TASKS = 7



Array.prototype.reactivePush = function (item) {
    this.push(item);
    this.update();
}

Array.prototype.reactivePop = function () {
    let res = this.pop();
    this.update();
    return res;
}

Array.prototype.reactiveShift = function () {
    let res = this.shift();
    this.update();
    return res;
}

Array.prototype.update = function () {
    let elmId = this.elmId;
    let arr = this;
    let islog = elmId === 'consolelog'
    let isJsstack = elmId === 'jsstack'
    let parentElm = document.getElementById(elmId);
    let items = [];
    for (let i = 0; i < arr.length; i++) {
        let item = arr[i];
        let style = '';
        if (i === 0 && !islog && !item.idel || isJsstack) {
            style = 'background-color: rgb(255, 223, 30);'
        }

        items.push(`<div class="event-loop-item" style="${style}">${item.name || item}</div>`)
    }
    parentElm.innerHTML = items.join('')
}


let helper = {
    isPromise: function (path) {
        let node = path.node || path;
        return types.isNewExpression(node) && types.isIdentifier(node.callee, {
            name: 'Promise'
        });
    },
    isSetTimeOut: function (callee) {
        callee = callee.node || callee;
        return types.isIdentifier(callee, {
            name: 'setTimeout'
        });
    },
    isConsolelog: function (callee) {
        callee = callee.node || callee;
        return types.isIdentifier(callee.object, {
            name: 'console'
        }) && types.isIdentifier(callee.property, {
            name: 'log'
        });
    },
    isThen: function (callee) {
        callee = callee.node || callee;
        return types.isIdentifier(callee.property, {
            name: 'then'
        });
    }
}

var babylon = Babel.babylon;
var traverse = Babel.traverse;
var types = Babel.types;

let functionDeclaration = new Map();

let variable = new Map();

let thenDep = new Map();

let fnPutOtherCount = {};

let tasksQueen = [];
let microtasksQueen = [];
let jsStack = [];
let log = [];
tasksQueen.elmId = 'taskqueue';
microtasksQueen.elmId = 'microtaskqueue';
jsStack.elmId = 'jsstack';
log.elmId = 'consolelog';


let callStack = [];

window.onkeydown = function (e) {
    if (e && e.keyCode == 9) {
        return false;
    }
}


let nextBtn = document.getElementsByClassName('next-btn')[0];
let prevBtn = document.getElementsByClassName('prev-btn')[0];

let codeText = document.getElementById('code');

nextBtn.onclick = function () {
    if (executedcallStack()) {
        return
    }

    let code = codeText.value;

    // code = `
    // async function async1() {
    //     console.log(1);
    //     const result = await async2();
    //     console.log(3);
    //   }
      
    //   async function async2() {
    //     console.log(2);
    //   }
      
    //   Promise.resolve().then(() => {
    //     console.log(4);
    //   });
      
    //   setTimeout(() => {
    //     console.log(5);
    //   });
      
    //   async1();
    //   console.log(6);`

    let ast = babylon.parse(code);

    function getThenKey(callee) {
        let start = callee.start;
        let end = callee.end;
        if (!start && !end && callee.loc) {
            start = callee.loc.start.column;
            end = callee.loc.end.column;
        }
        // if (types.isCallExpression(callee.object)) {
        //     start = callee.object.callee.start;
        //     end = callee.object.callee.end;
        // }
        return `start:${start} end:${end}`;
    }

    function handelPromise(path, itemCallQuene) {
        let type = FUNCTION;
        let calleePath = path.get('callee');
        let args = path.get('arguments');
        calleePath.node.customName = 'Promise executor';
        call({ calleePath, type, itemCallQuene, anonymousFn: args[0], path });
    }

    function dealWithThen(expression) {
        let itemCallee = expression.get('callee');
        let fn = expression.get('arguments')[0];

        while (itemCallee) {
            let object = itemCallee.node.object;
            let isNextThen = false
            if (types.isCallExpression(object)) {
                isNextThen = types.isIdentifier(object.callee.property, {
                    name: 'then'
                });
                let key = getThenKey(isNextThen ? object.arguments[0] : object.callee);
                if (!thenDep.has(key)) {
                    thenDep.set(key, fn)
                }
            } else if (types.isIdentifier(object)) {
                // let a = new Promise();
                // a.then();
                let { name } = object;
                let { callee } = variable.get(name);
                let key = getThenKey(callee);
                if (!thenDep.has(key)) {
                    thenDep.set(key, fn)
                }
            }
            // todo:new Promise().then();
            if (isNextThen) {
                fn = itemCallee.get('object.arguments')[0];
                itemCallee = itemCallee.get('object.callee');
            } else {
                itemCallee = null
            }
        }
    }

    function findCallFromThenExpression(callee) {
        if (types.isIdentifier(callee.node.object)) {
            return callee
        } else if (types.isCallExpression(callee.node.object)) {
            return findCallFromThenExpression(callee.get('object.callee'));
        }
    }


    function callDep(key, contextKey, args) {
        if (thenDep.has(key)) {
            let node = thenDep.get(key);
            //执行完一个function 如果有依赖的放入microtasksQueen
            microtasksQueen.reactivePush({
                name: 'thenCallback',
                fn: node,
                idel: true,
                args
            })
        }
        if (contextKey) {
            fnPutOtherCount[contextKey] && fnPutOtherCount[contextKey]--;
            if (fnPutOtherCount[contextKey] === 0 && fnPutOtherCount[contextKey].callBack) {
                fnPutOtherCount[contextKey].callBack();
            }
        }
    }

    function executedcallStack() {
        if (callStack.length) {
            let task = callStack[callStack.length - 1];
            let { name, quene, type, loc } = task;
            let key = getThenKey(loc);
            if (quene.length === 0) {
                callStack.pop();

                let contextKey = getThenKey(task.contextPath.node);
                if (!fnPutOtherCount[key]) {
                    callDep(key, contextKey);
                } else {
                    fnPutOtherCount[key].callBack = () => {
                        callDep(key, contextKey);
                    }
                }

                let jsStackFream = jsStack.reactivePop();
                if (jsStackFream) {
                    if (jsStackFream.type === MICROTASKS) {
                        microtasksQueen.reactiveShift();
                    }
                    else if (jsStackFream.type === TASKS) {
                        tasksQueen.reactiveShift();
                    }
                }
                return executedcallStack();
            } else {
                if (jsStack.length === 0 ||
                    (jsStack[jsStack.length - 1].name ? jsStack[jsStack.length - 1].name : jsStack[jsStack.length - 1]) !== name) {
                    if (type === MICROTASKS) {
                        microtasksQueen[0].idel = false;
                        microtasksQueen.update();
                    }
                    if (type) {
                        jsStack.reactivePush({
                            name,
                            type: type
                        });
                    }
                    else {
                        jsStack.reactivePush(name);
                    }
                    if (tasksQueen.length === 0) {
                        tasksQueen.reactivePush('run ' + name);
                    }
                }
                runTask(quene, loc);
                return true
            }

        } else {
            let task = null
            let type = TASKS;
            //首先检查有没有微任务需要执行
            if (microtasksQueen.length) {
                type = MICROTASKS
                task = microtasksQueen[0];
            } else if (tasksQueen.length) {
                //宏任务开始
                task = tasksQueen[0];
            }
            if (!task) {
                return false;
            }
            let fn = task.fn;
            let fream;
            let args = task.args;
            if (fn) {
                debugger
                fn.traverse(getVistor(`${task.name}${fn.node.start}${fn.node.end}`, (f) => {
                    fream = f;
                    fream.type = MICROTASKS
                }, args))
            }
            if (!fream) {
                fream = task;
            }
            fream.type = type;
            callStack.push(fream);
            return executedcallStack();
        }

    }

    function getTotalStackCount() {
        return microtasksQueen.length + tasksQueen.length;
    }

    function runTask(quene, taskloc) {
        if (quene.length) {
            let stackTask = quene.shift();
            let { loc, msg, then } = stackTask;
            setCodeLoc(loc);
            showMsg(msg);
            if (then) {
                let prveTotalCount = getTotalStackCount();
                then();
                let afterTotalCount = getTotalStackCount();
                let count = afterTotalCount - prveTotalCount;
                // 一个方法中可能又在callstack中添加了新任务
                // 为了判断一个方法是否完全执行完,需要收集是否执行完的依赖
                if (count > 0) {
                    let key = getThenKey(taskloc);
                    if (!fnPutOtherCount[key]) {
                        fnPutOtherCount[key] = 0
                    }
                    fnPutOtherCount[key] += count;
                }
            }
        }
    }

    function showMsg(msg) {
        let elm = document.getElementsByClassName('event-loop-commentary-item')[0];
        elm.innerHTML = msg;
        if (!elm.classList.contains('display')) {
            elm.classList.add("display");
        }
    }

    function setCodeLoc(loc) {
        let elm = document.getElementsByClassName('line-highlight')[0];
        if (!elm.classList.contains('display')) {
            elm.classList.add("display");
        }
        let line = loc.start.line - 1;
        elm.style.top = line * 20 + 4 + 'px';
    }

    function dealWithCallExpression(path, isAwait, itemCallQuene, args) {
        let expression = isAwait ? path.get('argument') : path.get('expression')
        let callee = expression.get('callee');
        let type = UNKNOW;
        //单纯调用
        if (types.isIdentifier(callee)) {
            let isSetTimeOut = helper.isSetTimeOut(callee);
            if (isSetTimeOut) {
                type = SETTIMEOUT;
            } else {
                type = isAwait ? AWAITFUNCTION : FUNCTION;
            }
        }
        //then
        else if (types.isMemberExpression(callee)) {
            let isConsolelog = helper.isConsolelog(callee);
            if (isConsolelog) {
                type = CONSOLELOG;
            }
            let isThen = helper.isThen(callee);
            if (isThen) {
                dealWithThen(expression);
                type = THEN;
            }
        }
        let calleeObj = callee;
        if (type === THEN) {
            calleeObj = findCallFromThenExpression(callee);
        }
        call({ calleePath: calleeObj, type, args: expression.get('arguments'), path, itemCallQuene, contextArgs: args })
        return type;
    }

    function call({ calleePath, type, args, path, itemCallQuene, anonymousFn, contextArgs }) {
        callee = calleePath.node;
        let callItem = null;
        if (type === SETTIMEOUT) {
            callItem = {
                type,
                loc: callee.loc,
                msg: 'setTimeOut,将callback放入tasksQueen队尾',
                then: function () {
                    let callContext = path.getFunctionParent();
                    debugger
                    //SETTIMEOUT put to call stack bottom 
                    tasksQueen.reactivePush({
                        name: 'setTimeout callback',
                        fn: args[0],
                        callContext
                    })
                }
            };
        }
        else if (type === THEN) {
            //then call the method and callback THEN
            callItem = {
                type,
                loc: callee.loc,
                msg: `${callee.object.name}.${callee.property.name},将then callback放入微任务`,
                then: function () {
                    debugger
                    if (types.isIdentifier(calleePath.node.object)) {
                        //put then call back into microtask.
                        let key = getThenKey(calleePath.node);
                        let then = thenDep.get(key);
                        microtasksQueen.reactivePush({
                            name: 'thenCallback',
                            fn: then,
                            idel: true
                        })
                    }

                }
            }

        } else if (type === CONSOLELOG) {
            let node = args[0].node;
            let consoleVal = undefined;
            // 处理 console.log(变量 【形参,实参】 )
            if (types.isIdentifier(node)) {
                // contextArgs
                let parentFn = calleePath.getFunctionParent();
                if (!types.isProgram(parentFn) && parentFn.node.params.length > 0) {
                    let index = parentFn.node.params.findIndex(param => param.name == node.name);
                    if (index > -1 && contextArgs.length > index) {
                        consoleVal = contextArgs[index].node.value;
                    }
                }
                if (consoleVal == null && variable.has(node.name)) {
                    consoleVal = variable.get(node.name).valStr;
                }
            } else {
                consoleVal = node.value;
            }
            callItem = {
                type,
                loc: callee.loc,
                msg: `console.log(${consoleVal})`,
                then: function () {
                    //push console.log queen.
                    log.reactivePush(consoleVal)
                }
            }
        } else if (type === FUNCTION) {
            let name = callee.customName || callee.name;
            callItem = {
                type,
                loc: callee.loc,
                msg: `执行${name}`,
                then: function () {
                    //todo:硬编码,这里调用的是一个形参.后面写测试用例覆盖掉这块问题
                    if (name === 'resolve') {

                        let parentPromise = calleePath.findParent((path) => helper.isPromise(path) || helper.isThen(path));
                        let callee = parentPromise.get('callee');
                        let key = getThenKey(callee.node);
                        let args = calleePath.parentPath.get('arguments');
                        callDep(key, null, args);
                    } else {
                        //push to js stack 
                        let fn = anonymousFn || functionDeclaration.get(name);
                        // helper.setTraverse(fn);
                        fn.traverse(getVistor(name, (fream) => {
                            callStack.push(fream);
                        }))
                    }

                }
            }
        } else if (type === AWAITFUNCTION) {
            let name = callee.name;
            callItem = {
                type,
                loc: callee.loc,
                callee: callee,
                msg: `执行await${name},将后续的内容加入微任务`,
                then: function () {
                    //push to js stack 
                    let fn = functionDeclaration.get(name);
                    fn.traverse(getVistor(name, (fream) => {
                        callStack.push(fream);
                    }))
                    let key = getThenKey(calleePath.node);
                    let then = thenDep.get(key);
                    microtasksQueen.reactivePush({
                        name: `await${name} Callback`,
                        fn: then,
                        idel: true
                    })
                }
            }
        }
        let lastItem = itemCallQuene[itemCallQuene.length - 1];
        if (lastItem && lastItem.type === AWAITFUNCTION) {
            let expression = path;
            // let parentfn = path.getFunctionParent();
            let key = getThenKey(lastItem.callee);
            if (!thenDep.has(key)) {
                //todo:这里直接修改了nodePath
                let keepItAfter = false;
                path.parentPath.traverse({
                    enter(_path) {
                        if (_path.node.start === expression.node.start
                            && _path.node.end === expression.node.end || keepItAfter) {
                            _path.skip();
                            keepItAfter = true;
                        } else {
                            _path.remove();
                        }

                    }
                })
                thenDep.set(key, path.parentPath.parentPath);
            }
        } else {
            itemCallQuene.push(callItem);
        }

    }

    function getVistor(name, callback, args) {
        let itemCallQuene = [];
        let contextPath;
        return {
            enter(path) {
                if (!contextPath && !types.isProgram(path)) {
                    contextPath = path.getFunctionParent();
                }
                if (types.isFunctionDeclaration(path) || types.isFunctionExpression(path)) {
                    path.skip && path.skip();
                    let id = path.node.id || path.parent.id;
                    let name = id.name;
                    functionDeclaration.set(name, path);
                    itemCallQuene.push({
                        loc: path.node.loc,
                        msg: '申明一个方法:' + name
                    })
                }
                else if (types.isExpressionStatement(path) || types.isExpressionStatement(path.node)) {
                    if (types.isCallExpression(path.expression) || types.isCallExpression(path.node.expression)) {
                        dealWithCallExpression(path, false, itemCallQuene, args);
                        path.skip && path.skip();
                    }
                } else if (types.isAwaitExpression(path)) {
                    if (types.isCallExpression(path.node.argument)) {
                        dealWithCallExpression(path, true, itemCallQuene, args);
                        path.skip && path.skip();
                    }
                }
                else if (types.isVariableDeclaration(path)) {
                    let declaration = path.get('declarations')[0];
                    let { id, init } = declaration.node;
                    let initPath = declaration.get('init');
                    if (types.isAwaitExpression(initPath)) {
                        return;
                    }
                    let name = id.name;
                    let isPromise = helper.isPromise(init);
                    let valStr = '';
                    let value = {};
                    // 变量申明目前只考虑两种情况
                    // Promise 和 Literal
                    // TODO:变量申明可能有调用一个方法要返回值等等情况
                    if (isPromise) {
                        handelPromise(initPath, itemCallQuene);
                        valStr = '[object Promise]';
                        value.callee = init.callee;
                    } else {
                        valStr = init.value;
                    }
                    value.valStr = valStr;
                    variable.set(name, value)
                    path.skip();
                }
            },
            exit(path) {
                if (types.isProgram(path) || types.isBlockStatement(path) || types.isFunctionExpression(path) || types.isArrowFunctionExpression(path) || !path) {
                    let start = path.node ? path.node.start : path.start;
                    let end = path.node ? path.node.end : path.end;
                    if (types.isBlockStatement(path)) {
                        start = path.container.start;
                        end = path.container.end;
                    }
                    let fream = {
                        contextPath,
                        name: name,
                        quene: itemCallQuene,
                        loc: {
                            start: start,
                            end: end
                        }
                    }
                    if (callback) {
                        callback(fream)
                    }
                }

            }
        }
    }

    traverse(ast, getVistor('script', (fream) => {
        tasksQueen.reactivePush(fream)
    }));

    executedcallStack()
}