require('source-map-support').install()
const path = require('path')
const fse = require('fs-extra')
import './error'
import './framework/base'

// 将配置参数写入到package.json中，将发布脚本封装到npm框架包中对应用透明。
// 通过package.json中的配置信息将其转换为config.sh脚本方便shell中加载使用实现shell与nodejs交互
let package_json_file_path = path.join(__dirname, './package.json')
let package_lock_json_file_path = path.join(__dirname, './package-lock.json')

// 必须确保package.json和package-lock.json同时存在保持版本一致性
xassert(fse.existsSync(package_json_file_path))
xassert(fse.existsSync(package_lock_json_file_path))

function upgrade_patch_version(file_path: string): string {
    let cfg = fse.readJsonSync(file_path)
    xassert(cfg && cfg.version && /(\d+)\.(\d+)\.(\d+)/.test(cfg.version))
    let list: any = /(\d+)\.(\d+)\.(\d+)/.exec(cfg.version)
    cfg.version = `${list[1]}.${list[2]}.${parseInt(list[3]) + 1}`
    fse.writeJSONSync(file_path, cfg, {spaces: 2})
    return cfg.version
}

// 保持事务更新一致性
const v1 = upgrade_patch_version(package_json_file_path)
const v2 = upgrade_patch_version(package_lock_json_file_path)
xassert(v1 === v2)

fse.writeFileSync(path.join(__dirname, './__version__'), v1 + '\r\n')
