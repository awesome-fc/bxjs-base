// TODO 需要改进为i18n类似的错误码的翻译处理成为配置数据的一部分

// 从前端视角约定的各种错误类型抽象（不用考虑具体的错误子类型，
//      子类型由xthrow的param参数进行具体的表达，
//      可以覆盖msg和code的提示信息扩展子类型进行约定即可 param:{[code,msg要求多语言配置,]other....}。）
// 在框架层面上将各种错误类型进行统一的抽象并在前端进行正确的错误信息的详细展示以及逻辑判定处理。
//      0无数据（null or undefined，期望接口中获取到的数据结果却不存在导致后续的逻辑无法继续下去），
//      1无权限（503 无访问权限），
//      2空页面 (404网址不存在类型错误)，
//      4搜索无结果（searchKeyWord by opensearch、database、cache、other data container），
//      5未知错误（500 服务器内部错误请稍后重试，未被定义的错误类型的错误被拦截）
//      3网页请求错误（对应于PARAM类型的错误），
//      ---------------------------------
//      页面配置数据获取失败导致错误页面无法正常加载需要出现空白页的错误提示纯粹的html处理显示，使用框架自定义的默认页面进行提示

// 对应到前端的错误页面显示模板内容提示信息
// - globals = {
//     errorType: 0,
//     errorMessage: 'XXXXXXXXX',
//     errorStack: 'XXXXXXXXX',
//     i18n: ...
// };
// errorType: 使用的图标不同而已，0无数据，1无权限，2空页面，3网页请求错误，4搜索无结果，5未知错误，
// errorMessage：显示给用户的错误信息
// errorStack：debug用的错误信息，快速点击页面7次显示出来

// 错误值的多语言翻译注册表
global['ERRORS'] = {}

// 错误码定义为ascii的utf8字符串作为唯一标识前端定义（前端code为int是0表示成功过，非0的int或string表示错误码）
// 1. 先在framework/error.ts文件中定义一个系统错误名称。
// 2. 在error.d.ts中定义全局符号定义.
// 3. 在应用工程的app/error.ts中扩展错误符号定义覆盖掉框架定义的错误码的多语言错误提示信息。
global['ERR$UNKNOWN'] = 'ERR$UNKNOWN'
global['ERRORS']['ERR$UNKNOWN'] = {
    'zh': '未知错误',
    'en': 'unknown error',
}

global['ERR$ASSERT'] = 'ERR$ASSERT'
global['ERRORS']['ERR$ASSERT'] = {
    'zh': '断言错误',
    'en': 'assert error',
}

global['ERR$PARAM'] = 'ERR$PARAM'
global['ERRORS']['ERR$PARAM'] = {
    'zh': '参数错误',
    'en': 'parameters error',
}

global['ERR$UNAUTHORIZED'] = 'ERR$UNAUTHORIZED'
global['ERRORS']['ERR$UNAUTHORIZED'] = {
    'zh': '未授权错误（请重新登录）',
    'en': 'unauthorized error（please login again）',
}

global['ERR$FORBIDDEN'] = 'ERR$FORBIDDEN'
global['ERRORS']['ERR$FORBIDDEN'] = {
    'zh': '无权限错误',
    'en': 'no right error',
}

global['ERR$EMPTY'] = 'ERR$EMPTY'
global['ERRORS']['ERR$EMPTY'] = {
    'zh': '空数据错误',
    'en': 'empty data error',
}

global['ERR$SEARCH'] = 'ERR$SEARCH'
global['ERRORS']['ERR$SEARCH'] = {
    'zh': '无搜索结果',
    'en': 'no search result',
}

global['ERR$CONFIG'] = 'ERR$CONFIG'
global['ERRORS']['ERR$CONFIG'] = {
    'zh': '配置信息错误',
    'en': 'config info error',
}
