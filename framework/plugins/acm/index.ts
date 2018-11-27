// Refer to document:  https://help.aliyun.com/document_detail/62670.html
const ACMClient = require('acm-client');
const co = require('co');

export class AppCfgData {
    protected _acm: any
    protected _cfg: any

    constructor(config: string = 'default') {
        this._cfg = xconfig(`plugins.acm.${config}`)
        xassert(this._cfg, ERR$CONFIG, {config})
        this._acm = new ACMClient(this._cfg)
    }

    public async data(data_id: string, data_group: string = 'DEFAULT_GROUP') {
        const _this = this
        return new Promise(async (resolve, reject) => {
            try {
                co(function* () {
                    try {
                        const content = yield _this._acm.getConfig(data_id, data_group)
                        xassert(content, ERR$CONFIG)
                        resolve(content)
                    } catch (err) {
                        xthrow(err, reject, {data_id, data_group, cfg: _this._cfg})
                    }
                });
            } catch (err) {
                xthrow(err, reject, {data_id, data_group, cfg: _this._cfg})
            }
        })
    }
}
