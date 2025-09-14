import { App, Plugin, PluginSettingTab, Setting, WorkspaceLeaf, ItemView, TFile } from 'obsidian';

// 插件的设置interface
interface KnowledgeMapSettings {
    dataFilePath: string;
    autoSave: boolean;
    defaultViewMode: 'global' | 'module';
    selectedModule?: string;
    mapTitle: string; // 地图标题
}

// 默认设置
const DEFAULT_SETTINGS: KnowledgeMapSettings = {
    dataFilePath: 'learning-data.md',
    autoSave: true,
    defaultViewMode: 'global',
    mapTitle: '学习进度地图'
}

// 知识点数据类型定义
interface KnowledgePoint {
    name: string;
    type: string;
    status: 'learned' | 'review' | 'unlearned';
    id: string;
    parentModule: string;
    parentSubModule?: string;
}

interface Module {
    name: string;
    type: string;
    children: SubModule[];
    knowledgePoints: KnowledgePoint[];
}

interface SubModule {
    name: string;
    type: string;
    knowledgePoints: KnowledgePoint[];
}

// 学习历史记录 - 统一的学习进度管理
interface DailyLearningRecord {
    date: string; // YYYY-MM-DD格式，如 "2024-12-15"
    newlyLearned: number; // 当日新掌握的知识点数量
}

interface LearningData {
    knowledgeData: Module[];
    learningHistory: DailyLearningRecord[]; // 学习历史记录（统一管理所有进度）
    lastUpdate: string;
    version: string;
}

// 主插件类
export default class KnowledgeMapPlugin extends Plugin {
    settings: KnowledgeMapSettings;
    data: LearningData | null = null;

    async onload() {
        // 加载设置
        await this.loadSettings();

        // 注册热力图视图
        this.registerView(
            VIEW_TYPE_KNOWLEDGE_MAP,
            (leaf) => new KnowledgeMapView(leaf, this)
        );

        // 添加侧边栏按钮
        this.addRibbonIcon('brain-circuit', '知识点地图', (evt: MouseEvent) => {
            this.activateView();
        });

        // 添加命令
        this.addCommand({
            id: 'open-knowledge-map',
            name: '打开知识点地图',
            callback: () => {
                this.activateView();
            }
        });

        // 添加设置选项卡
        this.addSettingTab(new KnowledgeMapSettingTab(this.app, this));

        // 加载学习数据
        this.data = await this.loadLearningData();
        
        console.log('知识点地图插件已加载');
    }

    onunload() {
        console.log('知识点地图插件已卸载');
    }

    async activateView() {
        const { workspace } = this.app;
        
        let leaf: WorkspaceLeaf | null = null;
        const leaves = workspace.getLeavesOfType(VIEW_TYPE_KNOWLEDGE_MAP);

        if (leaves.length > 0) {
            // 如果视图已存在，就激活它
            leaf = leaves[0];
        } else {
            // 在主编辑区域创建新标签页
            leaf = workspace.getLeaf('tab');
            if (leaf) {
                await leaf.setViewState({ type: VIEW_TYPE_KNOWLEDGE_MAP, active: true });
            }
        }

        // 显示视图
        if (leaf) {
            workspace.setActiveLeaf(leaf);
        }
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await super.loadData());
    }

    async saveSettings() {
        await super.saveData(this.settings);
    }

    async loadLearningData(): Promise<LearningData | null> {
        try {
            const file = this.app.vault.getAbstractFileByPath(this.settings.dataFilePath);
            if (file && file instanceof TFile) {
                const content = await this.app.vault.read(file);
                
                // 判断文件类型
                if (this.settings.dataFilePath.endsWith('.md')) {
                    // Markdown文件：提取JSON代码块
                    return this.extractJsonFromMarkdown(content);
                } else {
                    // JSON文件：直接解析
                    const data = JSON.parse(content) as LearningData;
                    return this.ensureDataCompatibility(data);
                }
            }
        } catch (error) {
            console.error('加载学习数据失败:', error);
        }
        return null;
    }

    // 确保数据兼容性，为旧数据添加新字段
    ensureDataCompatibility(data: any): LearningData {
        // 如果没有learningHistory字段，初始化为空数组
        if (!data.learningHistory) {
            data.learningHistory = [];
        }
        
        // 清理旧的字段
        if (data.todayProgress !== undefined) {
            delete data.todayProgress;
        }
        
        // 清理learningHistory中的旧字段
        if (data.learningHistory && Array.isArray(data.learningHistory)) {
            data.learningHistory = data.learningHistory.map((record: any) => ({
                date: record.date,
                newlyLearned: record.newlyLearned || 0
            }));
        }
        
        return data as LearningData;
    }

    // 获取今日日期字符串（YYYY-MM-DD格式）
    getTodayDateString(): string {
        const today = new Date();
        return today.toISOString().split('T')[0];
    }

    // 获取详细的日期信息，用于调试和展示
    getDateInfo(dateString?: string): { 
        date: string, 
        dayOfWeek: number, 
        dayName: string,
        isToday: boolean 
    } {
        const targetDate = dateString ? new Date(dateString) : new Date();
        const today = this.getTodayDateString();
        const targetDateString = targetDate.toISOString().split('T')[0];
        
        const dayOfWeek = targetDate.getDay(); // 0=周日, 1=周一, ..., 6=周六
        const dayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
        
        return {
            date: targetDateString,
            dayOfWeek,
            dayName: dayNames[dayOfWeek],
            isToday: targetDateString === today
        };
    }

    // 记录学习历史
    recordLearningProgress(pointId: string, oldStatus: string, newStatus: string) {
        if (!this.data) return;

        const today = this.getTodayDateString();
        let todayRecord = this.data.learningHistory.find(record => record.date === today);
        
        // 如果今天没有记录，创建新记录
        if (!todayRecord) {
            todayRecord = {
                date: today,
                newlyLearned: 0
            };
            this.data.learningHistory.push(todayRecord);
        }

        // 记录状态变化 - 只记录新掌握的知识点
        if (oldStatus === 'unlearned' && newStatus === 'learned') {
            // 新掌握一个知识点
            todayRecord.newlyLearned++;
        }
        // 其他状态变化（learned <-> review）不记录在历史中

        // 注意：不再需要记录 totalLearned，可以实时计算

        // 清理超过30天的历史记录，保持数据量合理
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const cutoffDate = thirtyDaysAgo.toISOString().split('T')[0];
        
        this.data.learningHistory = this.data.learningHistory.filter(
            record => record.date >= cutoffDate
        );
    }

    extractJsonFromMarkdown(markdownContent: string): LearningData | null {
        try {
            // 匹配JSON代码块的正则表达式
            const jsonBlockRegex = /```json\s*\n([\s\S]*?)\n```/;
            const match = markdownContent.match(jsonBlockRegex);
            
            if (match && match[1]) {
                const jsonString = match[1].trim();
                const data = JSON.parse(jsonString) as LearningData;
                return this.ensureDataCompatibility(data);
            } else {
                console.error('在Markdown文件中未找到JSON代码块');
                return null;
            }
        } catch (error) {
            console.error('解析Markdown中的JSON失败:', error);
            return null;
        }
    }

    async saveLearningData(data: LearningData) {
        try {
            let fileContent: string;
            
            if (this.settings.dataFilePath.endsWith('.md')) {
                // Markdown文件：嵌入JSON到代码块中
                fileContent = this.createMarkdownWithJson(data);
            } else {
                // JSON文件：直接保存JSON
                fileContent = JSON.stringify(data, null, 2);
            }
            
            await this.app.vault.adapter.write(this.settings.dataFilePath, fileContent);
            this.data = data;
        } catch (error) {
            console.error('保存学习数据失败:', error);
        }
    }

    createMarkdownWithJson(data: LearningData): string {
        const jsonString = JSON.stringify(data, null, 2);
        
        return `\`\`\`json
${jsonString}
\`\`\``;
    }


    async updateKnowledgePointStatus(pointId: string, newStatus: 'learned' | 'review' | 'unlearned', shouldRecordHistory: boolean = true) {
        // 如果没有数据，先尝试加载
        if (!this.data) {
            this.data = await this.loadLearningData();
            if (!this.data) {
                console.error('无法加载学习数据');
                return;
            }
        }

        console.log(`尝试更新知识点 ${pointId} 到状态 ${newStatus}`);

        // 记录更新前的状态，用于学习历史记录
        let oldStatus: string | null = null;
        
        // 更新知识点状态
        let updated = false;
        
        // 使用标签来跳出嵌套循环
        outerLoop: for (const module of this.data.knowledgeData) {
            // 检查模块级别的知识点
            for (const point of module.knowledgePoints) {
                if (point.id === pointId) {
                    console.log(`找到模块级知识点: ${point.name}, 当前状态: ${point.status}`);
                    oldStatus = point.status; // 记录原状态
                    point.status = newStatus;
                    updated = true;
                    break outerLoop;
                }
            }
            
            // 检查子模块级别的知识点
            for (const subModule of module.children) {
                for (const point of subModule.knowledgePoints) {
                    if (point.id === pointId) {
                        console.log(`找到子模块级知识点: ${point.name}, 当前状态: ${point.status}`);
                        oldStatus = point.status; // 记录原状态
                        point.status = newStatus;
                        updated = true;
                        break outerLoop;
                    }
                }
            }
        }

        if (updated && oldStatus !== null) {
            console.log(`知识点状态更新成功: ${pointId} -> ${newStatus}`);
            
            // 记录学习历史（根据参数决定是否记录）
            if (shouldRecordHistory) {
                this.recordLearningProgress(pointId, oldStatus, newStatus);
            }
            
            // 更新最后修改时间
            this.data.lastUpdate = new Date().toISOString();
            
            // 保存数据
            try {
                await this.saveLearningData(this.data);
                console.log('数据保存成功');
            } catch (error) {
                console.error('保存数据失败:', error);
            }
        } else {
            console.error(`未找到知识点: ${pointId}`);
        }
    }
}

// 视图类型常量
const VIEW_TYPE_KNOWLEDGE_MAP = "knowledge-map-view";

// 主视图类
class KnowledgeMapView extends ItemView {
    plugin: KnowledgeMapPlugin;
    currentViewMode: 'global' | 'module' = 'global';
    selectedModule: string | null = null;
    moduleData: Module[] = [];

    constructor(leaf: WorkspaceLeaf, plugin: KnowledgeMapPlugin) {
        super(leaf);
        this.plugin = plugin;
        this.currentViewMode = plugin.settings.defaultViewMode;
        this.selectedModule = plugin.settings.selectedModule || null;
    }

    getViewType() {
        return VIEW_TYPE_KNOWLEDGE_MAP;
    }

    getDisplayText() {
        return "知识点地图";
    }

    getIcon() {
        return "brain-circuit";
    }

    async onOpen() {
        const container = this.containerEl.children[1];
        container.empty();
        container.addClass('knowledge-map-container');

        // 创建顶部控制栏
        const toolbar = container.createEl('div', { cls: 'km-toolbar' });
        
        // 标题区域
        const titleArea = toolbar.createEl('div', { cls: 'km-title-area' });
        titleArea.createEl('h3', { text: `📊 ${this.plugin.settings.mapTitle}` });
        
        // 控制按钮区域
        const controlArea = toolbar.createEl('div', { cls: 'km-control-area' });
        
        // 视图模式切换器
        const modeToggle = controlArea.createEl('div', { cls: 'km-mode-toggle' });
        const globalBtn = modeToggle.createEl('button', { 
            cls: `km-mode-btn ${this.currentViewMode === 'global' ? 'active' : ''}`,
            text: '🌍 全局'
        });
        const moduleBtn = modeToggle.createEl('button', { 
            cls: `km-mode-btn ${this.currentViewMode === 'module' ? 'active' : ''}`,
            text: '📚 模块'
        });
        
        // 模块搜索器（仅在模块模式下显示）
        const moduleSearchContainer = controlArea.createEl('div', { cls: 'km-module-search-container' });
        const moduleSearch = moduleSearchContainer.createEl('input', { 
            cls: 'km-module-search',
            attr: { 
                type: 'text', 
                placeholder: '搜索模块...',
                value: this.selectedModule || ''
            }
        });
        const moduleDropdown = moduleSearchContainer.createEl('div', { cls: 'km-module-dropdown' });
        
        // 绑定事件
        globalBtn.addEventListener('click', () => this.switchViewMode('global'));
        moduleBtn.addEventListener('click', () => this.switchViewMode('module'));
        
        // 搜索输入事件
        moduleSearch.addEventListener('input', (e) => {
            const query = (e.target as HTMLInputElement).value;
            this.filterModules(query, moduleDropdown);
        });
        
        // 获得焦点时显示下拉列表
        moduleSearch.addEventListener('focus', () => {
            this.showModuleDropdown(moduleDropdown);
        });
        
        // 失去焦点时隐藏下拉列表（延迟以允许点击选项）
        moduleSearch.addEventListener('blur', () => {
            setTimeout(() => {
                moduleDropdown.style.display = 'none';
            }, 200);
        });

        // 主内容区域
        const contentContainer = container.createEl('div', { cls: 'km-content' });
        
        await this.setupModuleSearch(moduleSearchContainer);
        await this.renderContent();
    }

    async onClose() {
        // 清理工作
    }

    async switchViewMode(mode: 'global' | 'module') {
        this.currentViewMode = mode;
        
        // 更新按钮状态
        const modeButtons = this.containerEl.querySelectorAll('.km-mode-btn');
        modeButtons.forEach(btn => btn.removeClass('active'));
        
        const activeBtn = this.containerEl.querySelector(`.km-mode-btn:${mode === 'global' ? 'first' : 'last'}-child`);
        activeBtn?.addClass('active');
        
        // 显示/隐藏模块搜索器
        const moduleSearchContainer = this.containerEl.querySelector('.km-module-search-container') as HTMLElement;
        if (moduleSearchContainer) {
            moduleSearchContainer.style.display = mode === 'module' ? 'block' : 'none';
        }
        
        // 重新渲染内容
        await this.renderContent();
        
        // 保存设置
        this.plugin.settings.defaultViewMode = mode;
        await this.plugin.saveSettings();
    }

    async setupModuleSearch(container: HTMLElement) {
        const data = await this.plugin.loadLearningData();
        if (!data) return;

        // 存储模块数据供搜索使用
        this.moduleData = data.knowledgeData;

        // 根据当前模式显示/隐藏
        container.style.display = this.currentViewMode === 'module' ? 'block' : 'none';
    }

    async showModuleDropdown(dropdown: HTMLElement) {
        dropdown.empty();
        dropdown.style.display = 'block';
        
        const data = await this.plugin.loadLearningData();
        if (!data) return;

        // 显示所有模块
        data.knowledgeData.forEach(module => {
            const option = dropdown.createEl('div', { 
                cls: 'km-module-option',
                text: module.name
            });
            
            option.addEventListener('click', () => {
                this.selectModule(module.name);
                dropdown.style.display = 'none';
            });
        });
    }

    async filterModules(query: string, dropdown: HTMLElement) {
        dropdown.empty();
        dropdown.style.display = 'block';
        
        const data = await this.plugin.loadLearningData();
        if (!data) return;

        // 过滤模块
        const filteredModules = data.knowledgeData.filter(module => 
            module.name.toLowerCase().includes(query.toLowerCase())
        );

        if (filteredModules.length === 0) {
            dropdown.createEl('div', { 
                cls: 'km-module-option km-no-results',
                text: '没有找到匹配的模块'
            });
            return;
        }

        filteredModules.forEach(module => {
            const option = dropdown.createEl('div', { 
                cls: 'km-module-option',
                text: module.name
            });
            
            // 高亮匹配的文字
            if (query) {
                const regex = new RegExp(`(${query})`, 'gi');
                option.innerHTML = module.name.replace(regex, '<mark>$1</mark>');
            }
            
            option.addEventListener('click', () => {
                this.selectModule(module.name);
                dropdown.style.display = 'none';
            });
        });
    }

    selectModule(moduleName: string) {
        this.selectedModule = moduleName;
        
        // 更新输入框的值
        const searchInput = this.containerEl.querySelector('.km-module-search') as HTMLInputElement;
        if (searchInput) {
            searchInput.value = moduleName;
        }
        
        // 保存设置
        this.plugin.settings.selectedModule = moduleName;
        this.plugin.saveSettings();
        
        // 重新渲染内容
        this.renderContent();
    }

    jumpToModuleView(moduleName: string) {
        console.log(`跳转到模块详细视图: ${moduleName}`);
        
        // 切换到模块视图模式
        this.currentViewMode = 'module';
        this.selectedModule = moduleName;
        
        // 更新工具栏按钮状态
        const modeButtons = this.containerEl.querySelectorAll('.km-mode-btn');
        modeButtons.forEach(btn => btn.removeClass('active'));
        
        const moduleBtn = this.containerEl.querySelector('.km-mode-btn:last-child');
        moduleBtn?.addClass('active');
        
        // 显示模块搜索器
        const moduleSearchContainer = this.containerEl.querySelector('.km-module-search-container') as HTMLElement;
        if (moduleSearchContainer) {
            moduleSearchContainer.style.display = 'block';
        }
        
        // 更新搜索输入框的值
        const searchInput = this.containerEl.querySelector('.km-module-search') as HTMLInputElement;
        if (searchInput) {
            searchInput.value = moduleName;
        }
        
        // 保存设置
        this.plugin.settings.defaultViewMode = 'module';
        this.plugin.settings.selectedModule = moduleName;
        this.plugin.saveSettings();
        
        // 重新渲染内容
        this.renderContent();
    }

    async renderContent() {
        const contentContainer = this.containerEl.querySelector('.km-content') as HTMLElement;
        if (!contentContainer) return;

        contentContainer.empty();

        if (this.currentViewMode === 'global') {
            await this.renderGlobalView(contentContainer);
        } else {
            await this.renderModuleView(contentContainer);
        }
    }

    async renderGlobalView(container: HTMLElement) {
        const data = await this.plugin.loadLearningData();
        if (!data) {
            container.createEl('p', { text: '无法加载学习数据', cls: 'km-error' });
            return;
        }

        // 添加总进度条在知识地图上方
        await this.renderGlobalProgressBar(container, data);

        // 创建战略地图容器
        const battleMapContainer = container.createEl('div', { cls: 'km-battle-map' });
        
        // 按知识点数量排序模块
        const sortedModules = [...data.knowledgeData].sort((a, b) => {
            const aCount = this.getModuleKnowledgePointCount(a);
            const bCount = this.getModuleKnowledgePointCount(b);
            return bCount - aCount; // 从大到小排序
        });

        // 计算响应式布局 - 根据容器宽度和模块数量动态调整
        const moduleCount = sortedModules.length;
        
        // 使用CSS Grid的auto-fit功能，自动适应容器宽度
        battleMapContainer.style.display = 'grid';
        battleMapContainer.style.gridTemplateColumns = 'repeat(auto-fit, minmax(320px, 1fr))';
        battleMapContainer.style.gridAutoRows = 'minmax(300px, auto)';
        battleMapContainer.style.gap = 'clamp(16px, 2vw, 24px)';
        battleMapContainer.style.padding = 'clamp(16px, 3vw, 24px)';
        battleMapContainer.style.alignContent = 'start';
        battleMapContainer.style.justifyContent = 'center';

        // 渲染每个模块的"领土"
        for (const module of sortedModules) {
            await this.renderModuleTerritory(battleMapContainer, module);
        }

        // 渲染"品"字形统计面板
        await this.renderTripleStatsPanel(container, data);
    }

    // 新的"品"字形统计面板
    async renderTripleStatsPanel(container: HTMLElement, data: LearningData) {
        const tripleStatsContainer = container.createEl('div', { cls: 'km-triple-stats-container' });
        
        // 左下角：基础统计
        await this.renderBasicStats(tripleStatsContainer, data);
        
        // 右下角：趋势分析
        await this.renderTrendAnalysis(tripleStatsContainer, data);
    }

    // 基础统计（左下角）
    async renderBasicStats(container: HTMLElement, data: LearningData) {
        const basicStatsPanel = container.createEl('div', { cls: 'km-basic-stats-panel' });
        
        // 标题
        const header = basicStatsPanel.createEl('div', { cls: 'km-stats-header' });
        header.createEl('h3', { text: '📊 学习统计' });

        // 统计卡片容器
        const cardsContainer = basicStatsPanel.createEl('div', { cls: 'km-stat-cards-container' });

        const todayStats = this.calculateTodayStats(data);
        const globalStats = this.calculateGlobalStats(data);

        // 今日新掌握
        this.createStatCard(cardsContainer, '今日新掌握', `${todayStats.newlyLearned}`, 'card-today');

        // 已掌握
        this.createStatCard(cardsContainer, '已掌握', `${globalStats.learned}`, 'card-learned', 
            `${((globalStats.learned / globalStats.total) * 100).toFixed(1)}%`);

        // 需复习
        this.createStatCard(cardsContainer, '需复习', `${globalStats.review}`, 'card-review', 
            `${((globalStats.review / globalStats.total) * 100).toFixed(1)}%`);

        // 未学习
        this.createStatCard(cardsContainer, '未学习', `${globalStats.unlearned}`, 'card-unlearned', 
            `${((globalStats.unlearned / globalStats.total) * 100).toFixed(1)}%`);

        // 总进度条已移至知识地图上方
    }

    // 渲染全局进度条（知识地图上方）
    async renderGlobalProgressBar(container: HTMLElement, data: LearningData) {
        const globalStats = this.calculateGlobalStats(data);
        const percentage = globalStats.total > 0 ? (globalStats.learned / globalStats.total) * 100 : 0;
        
        const progressSection = container.createEl('div', { cls: 'km-global-progress-section' });
        
        // 进度标题和百分比
        const progressHeader = progressSection.createEl('div', { cls: 'km-global-progress-header' });
        progressHeader.createEl('span', { cls: 'km-global-progress-title', text: '总进度' });
        progressHeader.createEl('span', { cls: 'km-global-progress-percentage', text: `${percentage.toFixed(1)}%` });
        
        // 进度条容器
        const progressContainer = progressSection.createEl('div', { cls: 'km-global-progress-bar-container' });
        const progressBar = progressContainer.createEl('div', { cls: 'km-global-progress-bar' });
        progressBar.style.width = `${percentage}%`;
        
        // 进度统计信息已移至左下角统计面板，此处不再重复显示
    }

    // 趋势分析（右下角）
    async renderTrendAnalysis(container: HTMLElement, data: LearningData) {
        const trendPanel = container.createEl('div', { cls: 'km-trend-analysis-panel' });
        
        // 标题
        const header = trendPanel.createEl('div', { cls: 'km-stats-header' });
        header.createEl('h3', { text: '📈 趋势分析' });

        // 本周学习数据
        const weeklyData = this.getWeeklyLearningData(data);
        
        // 柱状图容器
        const chartContainer = trendPanel.createEl('div', { cls: 'km-chart-container' });
        this.renderWeeklyChart(chartContainer, weeklyData);

        // 学习速率指标
        const metricsContainer = trendPanel.createEl('div', { cls: 'km-metrics-container' });
        
        const avgRate = this.calculateDailyAverageRate(weeklyData);
        const learningStreak = this.calculateLearningStreak(data);
        
        // 日平均学习速率
        const rateCard = metricsContainer.createEl('div', { cls: 'km-metric-card' });
        rateCard.createEl('div', { cls: 'km-metric-label', text: '日平均速率' });
        rateCard.createEl('div', { cls: 'km-metric-value', text: `${avgRate.toFixed(1)} 个/天` });
        
        // 学习连续天数
        const streakCard = metricsContainer.createEl('div', { cls: 'km-metric-card' });
        streakCard.createEl('div', { cls: 'km-metric-label', text: '连续学习' });
        streakCard.createEl('div', { cls: 'km-metric-value', text: `${learningStreak} 天` });
    }

    // 获取本周学习数据（周一到周日）
    getWeeklyLearningData(data: LearningData): DailyLearningRecord[] {
        const today = new Date();
        const weekStart = new Date(today);
        
        // 计算本周一的日期
        const dayOfWeek = today.getDay(); // 0=周日, 1=周一, 2=周二, ..., 6=周六
        const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek; 
        // 周日时往回推6天到周一，其他时候推到周一
        weekStart.setDate(today.getDate() + mondayOffset);
        
        console.log(`今天是: ${this.plugin.getDateInfo().dayName} (${this.plugin.getDateInfo().date})`);
        console.log(`本周一: ${this.plugin.getDateInfo(weekStart.toISOString().split('T')[0]).dayName} (${weekStart.toISOString().split('T')[0]})`);
        
        const weeklyData: DailyLearningRecord[] = [];
        
        for (let i = 0; i < 7; i++) {
            const date = new Date(weekStart);
            date.setDate(weekStart.getDate() + i);
            const dateString = date.toISOString().split('T')[0];
            
            // 查找该日期的学习记录
            const record = data.learningHistory.find(r => r.date === dateString);
            if (record) {
                weeklyData.push(record);
            } else {
                // 如果没有记录，创建空记录
                weeklyData.push({
                    date: dateString,
                    newlyLearned: 0
                });
            }
        }
        
        return weeklyData;
    }

    // 计算日平均学习速率
    calculateDailyAverageRate(weeklyData: DailyLearningRecord[]): number {
        const totalLearned = weeklyData.reduce((sum, day) => sum + day.newlyLearned, 0);
        return totalLearned / 7;
    }

    // 计算学习连续天数
    calculateLearningStreak(data: LearningData): number {
        if (!data.learningHistory.length) return 0;
        
        const sortedHistory = [...data.learningHistory].sort((a, b) => b.date.localeCompare(a.date));
        let streak = 0;
        let currentDate = new Date();
        
        for (const record of sortedHistory) {
            const recordDate = new Date(record.date);
            const daysDiff = Math.floor((currentDate.getTime() - recordDate.getTime()) / (1000 * 60 * 60 * 24));
            
            if (daysDiff === streak && record.newlyLearned > 0) {
                streak++;
                currentDate = recordDate;
            } else {
                break;
            }
        }
        
        return streak;
    }

    // 渲染本周柱状图
    renderWeeklyChart(container: HTMLElement, weeklyData: DailyLearningRecord[]) {
        const chartWrapper = container.createEl('div', { cls: 'km-chart-wrapper' });
        
        // 不显示标题，直接显示图表
        
        // 柱状图容器
        const chartBars = chartWrapper.createEl('div', { cls: 'km-chart-bars' });
        
        const maxValue = Math.max(...weeklyData.map(d => d.newlyLearned), 1);
        const dayNames = ['一', '二', '三', '四', '五', '六', '日'];
        
        weeklyData.forEach((dayData, index) => {
            const barContainer = chartBars.createEl('div', { cls: 'km-chart-bar-container' });
            
            // 柱状图
            const bar = barContainer.createEl('div', { cls: 'km-chart-bar' });
            const height = (dayData.newlyLearned / maxValue) * 65; // 最大高度65px，适应更大空间
            bar.style.height = `${height}px`;
            bar.setAttribute('data-value', dayData.newlyLearned.toString());
            
            // 如果是今天，高亮显示
            const today = new Date().toISOString().split('T')[0];
            if (dayData.date === today) {
                bar.classList.add('today');
            }
            
            // 数值标签
            if (dayData.newlyLearned > 0) {
                bar.createEl('div', { cls: 'km-chart-value', text: dayData.newlyLearned.toString() });
            }
            
            // 日期标签
            barContainer.createEl('div', { cls: 'km-chart-label', text: dayNames[index] });
        });
    }

    // 旧的统计面板函数（保留用于兼容）
    async renderStatsPanel(container: HTMLElement, data: LearningData) {
        const statsPanel = container.createEl('div', { cls: 'km-stats-panel' });
        
        // 标题
        const header = statsPanel.createEl('div', { cls: 'km-stats-header' });
        header.createEl('h3', { text: '📈 学习统计' });

        const cardsContainer = statsPanel.createEl('div', { cls: 'km-stat-cards-container' });

        // 计算统计数据
        const todayStats = this.calculateTodayStats(data);
        const globalStats = this.calculateGlobalStats(data);

        // 创建统计卡片
        this.createStatCard(cardsContainer, '今日新掌握', `${todayStats.newlyLearned}`, 'today');
        this.createStatCard(cardsContainer, '已掌握', `${globalStats.learned}`, 'learned', `${((globalStats.learned / globalStats.total) * 100).toFixed(1)}%`);
        this.createStatCard(cardsContainer, '需复习', `${globalStats.review}`, 'review', `${((globalStats.review / globalStats.total) * 100).toFixed(1)}%`);
        this.createStatCard(cardsContainer, '未学习', `${globalStats.unlearned}`, 'unlearned', `${((globalStats.unlearned / globalStats.total) * 100).toFixed(1)}%`);

        // 创建总进度条
        const progressWrapper = statsPanel.createEl('div', { cls: 'km-progress-wrapper' });
        progressWrapper.createEl('span', { cls: 'km-progress-label', text: '总进度' });
        
        const progressBarContainer = progressWrapper.createEl('div', { cls: 'km-progress-bar-container' });
        const progressBar = progressBarContainer.createEl('div', { cls: 'km-progress-bar' });
        
        const percentage = globalStats.total > 0 ? (globalStats.learned / globalStats.total) * 100 : 0;
        progressBar.style.width = `${percentage}%`;
        
        progressWrapper.createEl('span', { cls: 'km-progress-percentage', text: `${percentage.toFixed(1)}%`});
    }

    createStatCard(container: HTMLElement, title: string, value: string, type: string, subtitle?: string) {
        const card = container.createEl('div', { cls: `km-stat-card card-${type}` });
        card.createEl('div', { cls: 'km-stat-card-title', text: title });
        card.createEl('div', { cls: 'km-stat-card-value', text: value });
        if (subtitle) {
            card.createEl('div', { cls: 'km-stat-card-subtitle', text: subtitle });
        }
    }

    calculateTodayStats(data: LearningData) {
        const today = this.plugin.getTodayDateString();
        
        // 从learningHistory中查找今日记录
        const todayRecord = data.learningHistory.find(record => record.date === today);
        
        if (todayRecord) {
            return { 
                newlyLearned: todayRecord.newlyLearned
            };
        }
        
        // 如果没有今日记录，返回0
        return { 
            newlyLearned: 0
        };
    }

    updateStatsPanel() {
        // 只在全局视图模式下更新统计面板
        if (this.currentViewMode !== 'global' || !this.plugin.data) {
            return;
        }

        // 更新全局进度条
        this.updateGlobalProgressBar();

        // 检查是否有新的"品"字形统计面板
        const tripleStatsContainer = this.containerEl.querySelector('.km-triple-stats-container') as HTMLElement;
        if (tripleStatsContainer) {
            // 更新新版布局
            this.updateTripleStatsPanel(tripleStatsContainer);
            return;
        }

        // 兼容旧版统计面板
        const statsPanel = this.containerEl.querySelector('.km-stats-panel') as HTMLElement;
        if (!statsPanel) {
            return;
        }

        // 重新计算统计数据
        const todayStats = this.calculateTodayStats(this.plugin.data);
        const globalStats = this.calculateGlobalStats(this.plugin.data);

        // 更新统计卡片的值
        const cards = statsPanel.querySelectorAll('.km-stat-card');
        
        // 今日新掌握
        const todayCard = cards[0];
        if (todayCard) {
            const valueEl = todayCard.querySelector('.km-stat-card-value');
            if (valueEl) valueEl.textContent = `${todayStats.newlyLearned}`;
        }

        // 已掌握
        const learnedCard = cards[1];
        if (learnedCard) {
            const valueEl = learnedCard.querySelector('.km-stat-card-value');
            const subtitleEl = learnedCard.querySelector('.km-stat-card-subtitle');
            if (valueEl) valueEl.textContent = `${globalStats.learned}`;
            if (subtitleEl) subtitleEl.textContent = `${((globalStats.learned / globalStats.total) * 100).toFixed(1)}%`;
        }

        // 需复习
        const reviewCard = cards[2];
        if (reviewCard) {
            const valueEl = reviewCard.querySelector('.km-stat-card-value');
            const subtitleEl = reviewCard.querySelector('.km-stat-card-subtitle');
            if (valueEl) valueEl.textContent = `${globalStats.review}`;
            if (subtitleEl) subtitleEl.textContent = `${((globalStats.review / globalStats.total) * 100).toFixed(1)}%`;
        }

        // 未学习
        const unlearnedCard = cards[3];
        if (unlearnedCard) {
            const valueEl = unlearnedCard.querySelector('.km-stat-card-value');
            const subtitleEl = unlearnedCard.querySelector('.km-stat-card-subtitle');
            if (valueEl) valueEl.textContent = `${globalStats.unlearned}`;
            if (subtitleEl) subtitleEl.textContent = `${((globalStats.unlearned / globalStats.total) * 100).toFixed(1)}%`;
        }

        // 更新进度条
        const progressBar = statsPanel.querySelector('.km-progress-bar') as HTMLElement;
        const percentageLabel = statsPanel.querySelector('.km-progress-percentage') as HTMLElement;
        
        if (progressBar && percentageLabel) {
            const percentage = globalStats.total > 0 ? (globalStats.learned / globalStats.total) * 100 : 0;
            progressBar.style.width = `${percentage}%`;
            percentageLabel.textContent = `${percentage.toFixed(1)}%`;
        }

    }

    // 更新全局进度条
    updateGlobalProgressBar() {
        if (!this.plugin.data) return;

        const progressSection = this.containerEl.querySelector('.km-global-progress-section');
        if (!progressSection) return;

        const globalStats = this.calculateGlobalStats(this.plugin.data);
        const percentage = globalStats.total > 0 ? (globalStats.learned / globalStats.total) * 100 : 0;

        // 更新百分比
        const percentageEl = progressSection.querySelector('.km-global-progress-percentage');
        if (percentageEl) {
            percentageEl.textContent = `${percentage.toFixed(1)}%`;
        }

        // 更新进度条
        const progressBar = progressSection.querySelector('.km-global-progress-bar') as HTMLElement;
        if (progressBar) {
            progressBar.style.width = `${percentage}%`;
        }

        // 统计信息已移至左下角面板，此处不再更新
    }

    // 更新新版"品"字形统计面板
    updateTripleStatsPanel(container: HTMLElement) {
        if (!this.plugin.data) return;

        // 重新计算统计数据
        const todayStats = this.calculateTodayStats(this.plugin.data);
        const globalStats = this.calculateGlobalStats(this.plugin.data);
        const weeklyData = this.getWeeklyLearningData(this.plugin.data);

        // 更新基础统计面板
        const basicStatsPanel = container.querySelector('.km-basic-stats-panel');
        if (basicStatsPanel) {
            const cards = basicStatsPanel.querySelectorAll('.km-stat-card');
            
            // 更新今日新掌握
            if (cards[0]) {
                const valueEl = cards[0].querySelector('.km-stat-card-value');
                if (valueEl) valueEl.textContent = `${todayStats.newlyLearned}`;
            }
            
            // 更新已掌握
            if (cards[1]) {
                const valueEl = cards[1].querySelector('.km-stat-card-value');
                const subtitleEl = cards[1].querySelector('.km-stat-card-subtitle');
                if (valueEl) valueEl.textContent = `${globalStats.learned}`;
                if (subtitleEl) subtitleEl.textContent = `${((globalStats.learned / globalStats.total) * 100).toFixed(1)}%`;
            }
            
            // 更新需复习
            if (cards[2]) {
                const valueEl = cards[2].querySelector('.km-stat-card-value');
                const subtitleEl = cards[2].querySelector('.km-stat-card-subtitle');
                if (valueEl) valueEl.textContent = `${globalStats.review}`;
                if (subtitleEl) subtitleEl.textContent = `${((globalStats.review / globalStats.total) * 100).toFixed(1)}%`;
            }
            
            // 更新未学习
            if (cards[3]) {
                const valueEl = cards[3].querySelector('.km-stat-card-value');
                const subtitleEl = cards[3].querySelector('.km-stat-card-subtitle');
                if (valueEl) valueEl.textContent = `${globalStats.unlearned}`;
                if (subtitleEl) subtitleEl.textContent = `${((globalStats.unlearned / globalStats.total) * 100).toFixed(1)}%`;
            }

            // 更新进度条
            const progressBar = basicStatsPanel.querySelector('.km-progress-bar') as HTMLElement;
            const percentageLabel = basicStatsPanel.querySelector('.km-progress-percentage') as HTMLElement;
            if (progressBar && percentageLabel) {
                const percentage = globalStats.total > 0 ? (globalStats.learned / globalStats.total) * 100 : 0;
                progressBar.style.width = `${percentage}%`;
                percentageLabel.textContent = `${percentage.toFixed(1)}%`;
            }
        }

        // 更新趋势分析面板
        const trendPanel = container.querySelector('.km-trend-analysis-panel');
        if (trendPanel) {
            // 更新柱状图
            const chartContainer = trendPanel.querySelector('.km-chart-container');
            if (chartContainer) {
                chartContainer.innerHTML = '';
                this.renderWeeklyChart(chartContainer as HTMLElement, weeklyData);
            }

            // 更新指标
            const avgRate = this.calculateDailyAverageRate(weeklyData);
            const learningStreak = this.calculateLearningStreak(this.plugin.data);

            const metricCards = trendPanel.querySelectorAll('.km-metric-card');
            if (metricCards[0]) {
                const valueEl = metricCards[0].querySelector('.km-metric-value');
                if (valueEl) valueEl.textContent = `${avgRate.toFixed(1)} 个/天`;
            }
            if (metricCards[1]) {
                const valueEl = metricCards[1].querySelector('.km-metric-value');
                if (valueEl) valueEl.textContent = `${learningStreak} 天`;
            }
        }
    }

    getModuleKnowledgePointCount(module: Module): number {
        let count = module.knowledgePoints.length;
        for (const subModule of module.children) {
            count += subModule.knowledgePoints.length;
        }
        return count;
    }

    async renderModuleTerritory(container: HTMLElement, module: Module) {
        // 创建模块领土容器 - 添加点击功能
        const territory = container.createEl('div', { 
            cls: 'km-territory km-territory-clickable',
            attr: {
                'data-module-name': module.name,
                'title': `点击查看 ${module.name} 详细信息`
            }
        });
        
        // 计算网格大小 - 根据知识点数量和容器大小动态计算最佳布局
        const totalPoints = this.getModuleKnowledgePointCount(module);
        
        // 动态计算最佳网格布局，考虑容器的响应式特性
        let gridCols, gridRows;
        if (totalPoints <= 16) {
            gridCols = Math.ceil(Math.sqrt(totalPoints));
        } else if (totalPoints <= 36) {
            gridCols = Math.min(8, Math.ceil(Math.sqrt(totalPoints)));
        } else {
            gridCols = Math.min(12, Math.ceil(Math.sqrt(totalPoints)));
        }
        gridRows = Math.ceil(totalPoints / gridCols);
        
        // 创建边框标题 - 也可点击
        const territoryHeader = territory.createEl('div', { cls: 'km-territory-header' });
        territoryHeader.createEl('span', { 
            text: `${module.name} (${totalPoints})`,
            cls: 'km-territory-title'
        });
        
        // 添加模块点击事件 - 跳转到模块详细视图
        territory.addEventListener('click', (e) => {
            // 防止知识点点击事件冒泡
            if (!(e.target as HTMLElement).closest('.km-grid-cell')) {
                this.jumpToModuleView(module.name);
            }
        });
        
        // 创建知识点网格
        const pointsGrid = territory.createEl('div', { cls: 'km-territory-grid' });
        pointsGrid.style.gridTemplateColumns = `repeat(${gridCols}, 1fr)`;
        pointsGrid.style.gridTemplateRows = `repeat(${gridRows}, 1fr)`;
        
        // 收集所有知识点
        const allPoints: KnowledgePoint[] = [];
        
        // 先添加模块级知识点
        allPoints.push(...module.knowledgePoints);
        
        // 再添加子模块知识点
        for (const subModule of module.children) {
            allPoints.push(...subModule.knowledgePoints);
        }
        
        // 渲染每个知识点为网格块
        for (let i = 0; i < totalPoints; i++) {
            const point = allPoints[i];
            if (point) {
                const gridCell = pointsGrid.createEl('div', {
                    cls: `km-grid-cell status-${point.status}`,
                    attr: {
                        'data-point-id': point.id,
                        'title': `${point.name} (${this.getStatusText(point.status)})`
                    }
                });
                
                // 添加点击事件
                gridCell.addEventListener('click', async (e) => {
                    e.stopPropagation(); // 防止事件冒泡到模块容器
                    await this.handlePointClick(point.id, point.status);
                });
                
                // 添加右键菜单
                gridCell.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    e.stopPropagation(); // 防止事件冒泡到模块容器
                    this.showContextMenu(e, point.id, point.status);
                });
            } else {
                // 填充空白网格保持布局
                pointsGrid.createEl('div', { cls: 'km-grid-cell km-empty-cell' });
            }
        }
    }

    async renderModuleView(container: HTMLElement) {
        if (!this.selectedModule) {
            container.createEl('div', { 
                cls: 'km-empty-state',
                text: '请选择一个模块查看详细信息'
            });
            return;
        }

        const data = await this.plugin.loadLearningData();
        if (!data) {
            container.createEl('p', { text: '无法加载学习数据', cls: 'km-error' });
            return;
        }

        const module = data.knowledgeData.find(m => m.name === this.selectedModule);
        if (!module) {
            container.createEl('p', { text: '未找到指定模块', cls: 'km-error' });
            return;
        }

        // 模块标题和统计
        const moduleHeader = container.createEl('div', { cls: 'km-module-detail-header' });
        moduleHeader.createEl('h3', { text: module.name });
        
        const moduleStats = this.calculateModuleStats(module);
        const statsRow = moduleHeader.createEl('div', { cls: 'km-module-stats' });
        
        statsRow.createEl('span', { 
            cls: 'km-stat learned',
            text: `已掌握 ${moduleStats.learned}`
        });
        statsRow.createEl('span', { 
            cls: 'km-stat review',
            text: `需复习 ${moduleStats.review}`
        });
        statsRow.createEl('span', { 
            cls: 'km-stat unlearned',
            text: `未学习 ${moduleStats.unlearned}`
        });

        // 详细知识点展示
        const detailContainer = container.createEl('div', { cls: 'km-module-detail' });
        
        // 模块级知识点
        if (module.knowledgePoints.length > 0) {
            const section = detailContainer.createEl('div', { cls: 'km-points-section' });
            section.createEl('h4', { text: '基础知识点' });
            this.renderDetailedPoints(section, module.knowledgePoints);
        }
        
        // 子模块知识点
        for (const subModule of module.children) {
            if (subModule.knowledgePoints.length > 0) {
                const section = detailContainer.createEl('div', { cls: 'km-points-section' });
                section.createEl('h4', { text: subModule.name });
                this.renderDetailedPoints(section, subModule.knowledgePoints);
            }
        }
    }

    renderMiniPoints(container: HTMLElement, points: KnowledgePoint[]) {
        for (const point of points) {
            const pointEl = container.createEl('div', { 
                cls: `km-point-mini status-${point.status}`,
                attr: { 
                    'data-point-id': point.id,
                    'title': `${point.name} (${this.getStatusText(point.status)})`
                }
            });
            
            pointEl.addEventListener('click', async (e) => {
                await this.handlePointClick(point.id, point.status);
            });
            
            // 添加右键菜单
            pointEl.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                this.showContextMenu(e, point.id, point.status);
            });
        }
    }

    renderDetailedPoints(container: HTMLElement, points: KnowledgePoint[]) {
        const pointsGrid = container.createEl('div', { cls: 'km-points-grid-detailed' });
        
        for (const point of points) {
            const pointEl = pointsGrid.createEl('div', { 
                cls: `km-point-detailed status-${point.status}`,
                attr: { 
                    'data-point-id': point.id,
                    'title': `点击切换状态`
                }
            });
            
            pointEl.createEl('span', { text: point.name, cls: 'km-point-name' });
            pointEl.createEl('span', { text: this.getStatusText(point.status), cls: 'km-point-status' });
            
            pointEl.addEventListener('click', async (e) => {
                await this.handlePointClick(point.id, point.status);
            });
            
            // 添加右键菜单
            pointEl.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                this.showContextMenu(e, point.id, point.status);
            });
        }
    }



    async handlePointClick(pointId: string, currentStatus: string) {
        // 首先从数据中获取当前的真实状态，因为DOM可能已经被之前的点击修改了
        const realCurrentStatus = this.getRealKnowledgePointStatus(pointId) || currentStatus;
        
        // 状态循环：unlearned -> learned -> review -> learned -> review -> ...
        // 只有未学习状态会变为已掌握，之后在已掌握和需复习之间循环
        let newStatus: 'learned' | 'review' | 'unlearned';
        
        switch (realCurrentStatus) {
            case 'unlearned':
                newStatus = 'learned';  // 未学习 → 已掌握
                break;
            case 'learned':
                newStatus = 'review';   // 已掌握 → 需复习
                break;
            case 'review':
                newStatus = 'learned';  // 需复习 → 已掌握
                break;
            default:
                newStatus = 'learned';
        }

        console.log(`更新知识点 ${pointId} 状态从 ${realCurrentStatus} 到 ${newStatus}`);

        // 立即更新当前点击的元素的视觉状态，避免闪烁
        const clickedElement = this.containerEl.querySelector(`[data-point-id="${pointId}"]`) as HTMLElement;
        if (clickedElement) {
            // 立即更新状态，不要延迟
            // 移除所有可能的旧状态类
            clickedElement.classList.remove('status-learned', 'status-review', 'status-unlearned');
            // 添加新状态类
            clickedElement.classList.add(`status-${newStatus}`);
            // 更新tooltip
            clickedElement.setAttribute('title', `${this.getPointNameById(pointId)} (${this.getStatusText(newStatus)})`);
            
            // 如果是详细视图，还需要更新状态文本
            const statusSpan = clickedElement.querySelector('.km-point-status') as HTMLElement;
            if (statusSpan) {
                statusSpan.textContent = this.getStatusText(newStatus);
            }
            
            // 添加状态切换动画（纯视觉效果）
            clickedElement.classList.add('status-changing');
            
            // 动画结束后移除动画类
            setTimeout(() => {
                clickedElement.classList.remove('status-changing');
            }, 300);
        }

        // 在后台更新数据，但不重新渲染整个界面
        await this.plugin.updateKnowledgePointStatus(pointId, newStatus);
        
        // 更新统计面板
        this.updateStatsPanel();
    }

    getRealKnowledgePointStatus(pointId: string): string | null {
        // 从数据中查找知识点的真实状态
        const data = this.plugin.data;
        if (!data) return null;
        
        for (const module of data.knowledgeData) {
            // 检查模块级知识点
            for (const point of module.knowledgePoints) {
                if (point.id === pointId) {
                    return point.status;
                }
            }
            
            // 检查子模块级知识点
            for (const subModule of module.children) {
                for (const point of subModule.knowledgePoints) {
                    if (point.id === pointId) {
                        return point.status;
                    }
                }
            }
        }
        return null;
    }

    showContextMenu(event: MouseEvent, pointId: string, currentStatus: string) {
        // 获取真实的当前状态
        const realCurrentStatus = this.getRealKnowledgePointStatus(pointId) || currentStatus;
        
        // 创建右键菜单
        const menu = document.createElement('div');
        menu.classList.add('km-context-menu');
        menu.style.position = 'fixed';
        menu.style.left = `${event.clientX}px`;
        menu.style.top = `${event.clientY}px`;
        menu.style.zIndex = '10000';
        
        // 获取知识点名称
        const pointName = this.getPointNameById(pointId);
        
        // 菜单标题
        const title = menu.createEl('div', { 
            cls: 'km-context-menu-title',
            text: pointName 
        });
        
        // 分隔线
        menu.createEl('div', { cls: 'km-context-menu-separator' });
        
        // 状态选项
        const statusOptions = [
            { status: 'learned', label: '✅ 已掌握', color: '#10b981' },
            { status: 'review', label: '🔄 需复习', color: '#f59e0b' },
            { status: 'unlearned', label: '⚪ 未学习', color: '#9ca3af' }
        ];
        
        statusOptions.forEach(option => {
            const menuItem = menu.createEl('div', { 
                cls: `km-context-menu-item ${realCurrentStatus === option.status ? 'active' : ''}`,
                text: option.label
            });
            
            menuItem.style.color = option.color;
            
            menuItem.addEventListener('click', async () => {
                if (option.status !== realCurrentStatus) {
                    await this.setKnowledgePointStatus(pointId, option.status as 'learned' | 'review' | 'unlearned');
                }
                document.body.removeChild(menu);
            });
        });
        
        // 添加到页面
        document.body.appendChild(menu);
        
        // 点击其他地方关闭菜单
        const closeMenu = (e: MouseEvent) => {
            if (!menu.contains(e.target as Node)) {
                document.body.removeChild(menu);
                document.removeEventListener('click', closeMenu);
            }
        };
        
        setTimeout(() => {
            document.addEventListener('click', closeMenu);
        }, 100);
    }

    async setKnowledgePointStatus(pointId: string, newStatus: 'learned' | 'review' | 'unlearned') {
        console.log(`通过右键菜单设置知识点 ${pointId} 状态为 ${newStatus}`);

        // 获取原状态并记录学习历史
        const oldStatus = this.getRealKnowledgePointStatus(pointId) || 'unlearned';
        this.plugin.recordLearningProgress(pointId, oldStatus, newStatus);

        // 立即更新DOM视觉效果
        const clickedElement = this.containerEl.querySelector(`[data-point-id="${pointId}"]`) as HTMLElement;
        if (clickedElement) {
            // 移除所有可能的旧状态类
            clickedElement.classList.remove('status-learned', 'status-review', 'status-unlearned');
            // 添加新状态类
            clickedElement.classList.add(`status-${newStatus}`);
            // 更新tooltip
            clickedElement.setAttribute('title', `${this.getPointNameById(pointId)} (${this.getStatusText(newStatus)})`);
            
            // 如果是详细视图，还需要更新状态文本
            const statusSpan = clickedElement.querySelector('.km-point-status') as HTMLElement;
            if (statusSpan) {
                statusSpan.textContent = this.getStatusText(newStatus);
            }
            
            // 添加状态切换动画
            clickedElement.classList.add('status-changing');
            setTimeout(() => {
                clickedElement.classList.remove('status-changing');
            }, 300);
        }

        // 在后台更新数据（不重复记录学习历史，因为上面已经记录了）
        await this.plugin.updateKnowledgePointStatus(pointId, newStatus, false);
        
        // 更新统计面板
        this.updateStatsPanel();
    }

    getPointNameById(pointId: string): string {
        // 从数据中查找知识点名称
        const data = this.plugin.data;
        if (!data) return '';
        
        for (const module of data.knowledgeData) {
            // 检查模块级知识点
            for (const point of module.knowledgePoints) {
                if (point.id === pointId) {
                    return point.name;
                }
            }
            
            // 检查子模块级知识点
            for (const subModule of module.children) {
                for (const point of subModule.knowledgePoints) {
                    if (point.id === pointId) {
                        return point.name;
                    }
                }
            }
        }
        return '';
    }

    calculateModuleProgress(module: Module): number {
        let totalPoints = module.knowledgePoints.length;
        let learnedPoints = module.knowledgePoints.filter(p => p.status === 'learned').length;
        
        // 加上子模块的知识点
        for (const subModule of module.children) {
            totalPoints += subModule.knowledgePoints.length;
            learnedPoints += subModule.knowledgePoints.filter(p => p.status === 'learned').length;
        }
        
        return totalPoints > 0 ? Math.round((learnedPoints / totalPoints) * 100) : 0;
    }

    calculateGlobalStats(data: LearningData) {
        let learned = 0, review = 0, unlearned = 0;
        
        for (const module of data.knowledgeData) {
            // 模块级知识点
            for (const point of module.knowledgePoints) {
                switch (point.status) {
                    case 'learned': learned++; break;
                    case 'review': review++; break;
                    case 'unlearned': unlearned++; break;
                }
            }
            
            // 子模块知识点
            for (const subModule of module.children) {
                for (const point of subModule.knowledgePoints) {
                    switch (point.status) {
                        case 'learned': learned++; break;
                        case 'review': review++; break;
                        case 'unlearned': unlearned++; break;
                    }
                }
            }
        }
        
        return {
            learned,
            review,
            unlearned,
            total: learned + review + unlearned
        };
    }

    calculateModuleStats(module: Module) {
        let learned = 0, review = 0, unlearned = 0;
        
        // 模块级知识点
        for (const point of module.knowledgePoints) {
            switch (point.status) {
                case 'learned': learned++; break;
                case 'review': review++; break;
                case 'unlearned': unlearned++; break;
            }
        }
        
        // 子模块知识点
        for (const subModule of module.children) {
            for (const point of subModule.knowledgePoints) {
                switch (point.status) {
                    case 'learned': learned++; break;
                    case 'review': review++; break;
                    case 'unlearned': unlearned++; break;
                }
            }
        }
        
        return { learned, review, unlearned };
    }

    getStatusText(status: string): string {
        switch (status) {
            case 'learned': return '已掌握';
            case 'review': return '需复习';
            case 'unlearned': return '未学习';
            default: return '未知';
        }
    }
}

// 设置选项卡
class KnowledgeMapSettingTab extends PluginSettingTab {
    plugin: KnowledgeMapPlugin;

    constructor(app: App, plugin: KnowledgeMapPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl('h2', { text: '知识点地图设置' });

        new Setting(containerEl)
            .setName('地图标题')
            .setDesc('设置知识点地图在顶部显示的标题文字')
            .addText(text => text
                .setPlaceholder('学习进度地图')
                .setValue(this.plugin.settings.mapTitle)
                .onChange(async (value) => {
                    this.plugin.settings.mapTitle = value || '学习进度地图';
                    await this.plugin.saveSettings();
                    // 如果当前有打开的视图，刷新标题显示
                    this.refreshMapTitle();
                }));

        new Setting(containerEl)
            .setName('数据文件路径')
            .setDesc('学习数据文件的路径（相对于vault根目录）。支持.md文件（推荐）或.json文件')
            .addText(text => text
                .setPlaceholder('learning-data.md')
                .setValue(this.plugin.settings.dataFilePath)
                .onChange(async (value) => {
                    this.plugin.settings.dataFilePath = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('自动保存')
            .setDesc('修改知识点状态时自动保存到文件')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.autoSave)
                .onChange(async (value) => {
                    this.plugin.settings.autoSave = value;
                    await this.plugin.saveSettings();
                }));

    }

    // 刷新地图标题显示
    refreshMapTitle() {
        // 查找当前打开的知识点地图视图
        const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_KNOWLEDGE_MAP);
        if (leaves.length > 0) {
            const view = leaves[0].view as KnowledgeMapView;
            if (view && view.containerEl) {
                const titleEl = view.containerEl.querySelector('.km-title-area h3');
                if (titleEl) {
                    titleEl.textContent = `📊 ${this.plugin.settings.mapTitle}`;
                }
            }
        }
    }
}
