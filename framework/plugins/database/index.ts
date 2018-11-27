import {Entity, BaseEntity, PrimaryColumn, BeforeInsert, CreateDateColumn, Index, UpdateDateColumn} from '@bxjs/typeorm'

const shortid = require('shortid')

export * from '@bxjs/typeorm'

@Entity()
export abstract class XBaseEntity extends BaseEntity {
    // 数据库自增主键存在分布式扩容以及安全隐患在阿里内部不适合使用，改进方案如下：
    // 阿里内部安全规范要求id不可预测不可枚举，不能使用int或bigint自增主键定义id。
    // 本项目适合将id使用shortid满足要求并且无需修改业务逻辑（并支持分布式id生成算法适合以后分库分表算法实现）
    @PrimaryColumn({type: 'char', length: '16'}) // 优化为char[16]固定长度便于主键索引查询性能优化（存储空间一点浪费不是问题）
    id: string

    @BeforeInsert()
    protected generateID() {
        this.id = shortid.generate()
        // 严格验证shortid的生成策略是否正确，如果出错第一时间报警排查问题。
        if (!(this.id && shortid.isValid(this.id) &&
                this.id.length >= 7 && this.id.length <= 14)) {
            xwarn({id: this.id})
            xassert(false, ERR$UNKNOWN)
        }
    }

    // 增加索引解决id随机后无法排序问题
    @Index()
    @CreateDateColumn()
    created_at: Date

    @UpdateDateColumn()
    updated_at: Date
}
