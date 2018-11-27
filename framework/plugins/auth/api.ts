import {injectable} from "inversify";
import * as _ from 'lodash'

@injectable()
export class YAuth {
    // TODO 插件名称必须要到BXJS平台上统一注册确保全局唯一性
    get id() {
        return 'YAuth'
    }

    // 登录逻辑实现（非常通用封装到父类规范中进行实现，业务应用中可以扩展系统的钩子函数实现保持代码风格统一实现）
    async login(user_id: string, user_param?: Object): Promise<void> {
        if (!user_param) {
            user_param = {}
        }
        xassert(!_.isEmpty(user_id) && _.isString(user_id) && _.isPlainObject(user_param))
        await xsession.set('__user__', {id: user_id, ...user_param})
        // 在全局变量中缓存基本的登录信息优化查询速度
        if (!global['__user__']) {
            global['__user__'] = {}
        }
        global['__user__'].id = user_id
        global['__user__'].param = {id: user_id, ...user_param}
    }

    // 登出逻辑实现
    async logout(): Promise<void> {
        await xsession.destroy()
        global['__user__'] = {}
    }

    // 判断是否处于登录状态(框架调用，实现entries自动登录鉴权功能实现)
    async getLoginStatus(): Promise<boolean> {
        const user = !_.isEmpty(global['__user__']) ? global['__user__'] :
            await xsession.get('__user__')
        if (_.isEmpty(global['__user__']) && user) {
            global['__user__'] = {...user}
        }
        return user && user.id
    }
}
