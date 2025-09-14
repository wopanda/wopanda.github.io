/**
 * 知识地图渲染器 - Web版
 * 适配自Obsidian插件，用于Hugo静态网站
 */
class KnowledgeMapRenderer {
    constructor(containerId) {
        this.containerId = containerId;
        this.container = null;
        this.knowledgeData = {};
        this.metadata = null;
        this.currentViewMode = 'global'; // 'global' 或 'module'
        this.selectedModule = null;
        this.moduleDetailView = 'cards'; // 'cards' | 'matrix'
        // 单例 tooltip 相关
        this._tooltipEl = null;
        this._tooltipTimer = null;
        this._resizeTimer = null;
    }

    /**
     * 初始化渲染器
     */
    async init() {
        this.container = document.getElementById(this.containerId);
        if (!this.container) {
            console.error(`找不到容器: ${this.containerId}`);
            return;
        }

        try {
            // 先尝试用本地缓存进行即时渲染，再后台刷新网络数据
            const hadCache = this.loadFromCache();
            if (hadCache) {
                this.render();
                this.refreshFromNetwork();
            } else {
                // 首次访问：先加载元数据并渲染骨架，再并行加载模块数据，完成后无动画替换
                await this.loadMetadataOnly();
                this.renderSkeleton();
                await this.loadModulesFromNetwork();
                this.render();
            }
            this.addProgressIndicator();
            // 响应式：窗口尺寸变化时，轻量防抖后重新渲染以适配移动端布局
            window.addEventListener('resize', () => {
                clearTimeout(this._resizeTimer);
                this._resizeTimer = setTimeout(() => this.render(), 200);
            });
        } catch (error) {
            console.error('知识地图初始化失败:', error);
            this.showError('加载知识地图时出现错误');
        }
    }

    /**
     * 尝试从本地缓存加载数据
     */
    loadFromCache() {
        try {
            const metaStr = localStorage.getItem('km_meta');
            if (!metaStr) return false;
            const meta = JSON.parse(metaStr);
            if (!meta || !Array.isArray(meta.modules)) return false;
            this.metadata = meta;
            let loadedAny = false;
            meta.modules.forEach(name => {
                const key = `km_mod_${name}`;
                const modStr = localStorage.getItem(key);
                if (!modStr) return;
                try {
                    const mod = JSON.parse(modStr);
                    if (mod) {
                        this.knowledgeData[name] = mod;
                        loadedAny = true;
                    }
                } catch (_) {}
            });
            return loadedAny;
        } catch (e) {
            return false;
        }
    }

    /**
     * 后台刷新网络数据，若版本或数据更新则轻量重渲染
     */
    async refreshFromNetwork() {
        const oldVersion = this.metadata && this.metadata.version;
        await this.loadDataFromNetwork();
        const newVersion = this.metadata && this.metadata.version;
        if (oldVersion !== newVersion) {
            // 版本变化时重渲染
            this.render();
            this.addProgressIndicator();
        }
    }

    /**
     * 从网络加载所有模块数据（含版本参数，利于缓存）
     */
    async loadDataFromNetwork() {
        // 先加载元数据以获取模块列表
        const metadataResponse = await fetch('/data/knowledge/_metadata.json', { cache: 'force-cache' });
        const meta = await metadataResponse.json();
        this.metadata = meta;
        try { localStorage.setItem('km_meta', JSON.stringify(meta)); } catch (_) {}

        const versionSuffix = meta && meta.version ? `?v=${encodeURIComponent(meta.version)}` : '';

        // 并行加载所有模块数据
        const loadPromises = (meta.modules || []).map(async moduleName => {
            const response = await fetch(`/data/knowledge/${moduleName}.json${versionSuffix}`, { cache: 'force-cache' });
            const moduleData = await response.json();
            this.knowledgeData[moduleName] = moduleData;
            try { localStorage.setItem(`km_mod_${moduleName}`, JSON.stringify(moduleData)); } catch (_) {}
        });

        await Promise.all(loadPromises);
    }

    /**
     * 仅加载元数据（用于首次访问时尽快渲染骨架屏）
     */
    async loadMetadataOnly() {
        const metadataResponse = await fetch('/data/knowledge/_metadata.json', { cache: 'force-cache' });
        const meta = await metadataResponse.json();
        this.metadata = meta;
        try { localStorage.setItem('km_meta', JSON.stringify(meta)); } catch (_) {}
    }

    /**
     * 仅加载模块数据（在元数据已加载的前提下）
     */
    async loadModulesFromNetwork() {
        const meta = this.metadata || { modules: [] };
        const versionSuffix = meta && meta.version ? `?v=${encodeURIComponent(meta.version)}` : '';
        const loadPromises = (meta.modules || []).map(async moduleName => {
            const response = await fetch(`/data/knowledge/${moduleName}.json${versionSuffix}`, { cache: 'force-cache' });
            const moduleData = await response.json();
            this.knowledgeData[moduleName] = moduleData;
            try { localStorage.setItem(`km_mod_${moduleName}`, JSON.stringify(moduleData)); } catch (_) {}
        });
        await Promise.all(loadPromises);
    }

    /**
     * 渲染骨架屏（基于元数据的模块名先展示占位，减少“加载中”时间感知）
     */
    renderSkeleton() {
        const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches || window.innerWidth <= 768;
        this.container.innerHTML = '';
        this.renderToolbar();
        const main = document.createElement('div');
        main.className = 'km-main-content';
        const map = document.createElement('div');
        map.className = 'km-battle-map';
        const frag = document.createDocumentFragment();
        const modules = (this.metadata && this.metadata.modules) || [];
        modules.forEach(name => {
            const territory = document.createElement('div');
            territory.className = 'km-territory km-skeleton';
            const header = document.createElement('div');
            header.className = 'km-territory-header';
            const title = document.createElement('div');
            title.className = 'km-territory-title km-skeleton-title';
            title.textContent = name;
            header.appendChild(title);
            const grid = document.createElement('div');
            grid.className = 'km-territory-grid km-skeleton-grid';
            territory.appendChild(header);
            territory.appendChild(grid);
            frag.appendChild(territory);
        });
        map.appendChild(frag);
        main.appendChild(map);
        this.container.appendChild(main);
        if (reduceMotion) {
            this.container.style.transition = 'none';
            this.container.style.opacity = '1';
            this.container.style.transform = 'none';
        }
    }

    /**
     * 加载所有模块数据
     */
    async loadData() {
        // 先加载元数据以获取模块列表
        const metadataResponse = await fetch('/data/knowledge/_metadata.json');
        this.metadata = await metadataResponse.json();

        // 并行加载所有模块数据
        const loadPromises = this.metadata.modules.map(async moduleName => {
            const response = await fetch(`/data/knowledge/${moduleName}.json`);
            const moduleData = await response.json();
            this.knowledgeData[moduleName] = moduleData;
        });

        await Promise.all(loadPromises);
    }

    /**
     * 渲染主界面
     */
    render() {
        // 切换视图前，清理遗留的全局 tooltip
        this.clearAllTooltips();

        const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches || window.innerWidth <= 768;
        if (!reduceMotion) {
            // 添加淡出动画
            this.container.style.opacity = '0';
            this.container.style.transform = 'translateY(20px)';
        }

        const doRender = () => {
            this.container.innerHTML = '';
            this.renderToolbar();
            this.renderMainContent();
            if (!reduceMotion) {
                requestAnimationFrame(() => {
                    this.container.style.transition = 'all 0.28s cubic-bezier(0.4, 0, 0.2, 1)';
                    this.container.style.opacity = '1';
                    this.container.style.transform = 'translateY(0)';
                });
            } else {
                this.container.style.transition = 'none';
                this.container.style.opacity = '1';
                this.container.style.transform = 'none';
            }
        };

        if (!reduceMotion) {
            // 微小延时让过渡更平滑，但不阻塞
            requestAnimationFrame(doRender);
        } else {
            doRender();
        }
    }

    // 移除页面上所有 tooltip（防止从全局切到模块后仍悬浮）
    clearAllTooltips() {
        const tips = document.querySelectorAll('.km-tooltip');
        tips.forEach(el => el.parentNode && el.parentNode.removeChild(el));
    }

    /**
     * 渲染工具栏
     */
    renderToolbar() {
        const toolbar = document.createElement('div');
        toolbar.className = 'km-toolbar';

        // 标题区域
        const titleArea = document.createElement('div');
        titleArea.className = 'km-title-area';
        const title = document.createElement('h3');
        
        if (this.currentViewMode === 'global') {
            title.textContent = '知识地图';
        } else {
            // 新：返回链接作为独立元素，避免继承 h3 的渐变文字
            const backLink = document.createElement('a');
            backLink.className = 'km-back-link';
            backLink.textContent = '◀ 返回全局视图';
            backLink.addEventListener('click', (e) => {
                e.preventDefault();
                this.switchToGlobalView();
            });

            title.textContent = this.selectedModule;
            titleArea.appendChild(backLink);
        }
        titleArea.appendChild(title);

        // 统计区域
        const statsArea = document.createElement('div');
        statsArea.className = 'km-stats';
        this.renderStats(statsArea);
        if (this.currentViewMode === 'module') {
            const curModule = this.knowledgeData[this.selectedModule];
            const hasChildren = !!(curModule && curModule.children && curModule.children.length);
            if (hasChildren) {
            const viewSwitch = document.createElement('div');
            viewSwitch.className = 'km-view-switch';
            viewSwitch.innerHTML = `
                <button class="km-switch-btn ${this.moduleDetailView==='cards'?'active':''}" data-view="cards">卡片</button>
                <button class="km-switch-btn ${this.moduleDetailView==='matrix'?'active':''}" data-view="matrix">矩阵</button>
            `;
            viewSwitch.querySelectorAll('.km-switch-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const v = btn.getAttribute('data-view');
                    if (v && v !== this.moduleDetailView) {
                        this.moduleDetailView = v;
                        this.render();
                    }
                });
            });
            statsArea.appendChild(viewSwitch);
            }
        }

        toolbar.appendChild(titleArea);
        toolbar.appendChild(statsArea);
        this.container.appendChild(toolbar);
        
        // 将渲染器实例保存到容器上，方便回调
        this.container.renderer = this;
    }

    /**
     * 渲染统计信息
     */
    renderStats(container) {
        const stats = this.calculateGlobalStats();
        
        const statItems = [
            { label: '已掌握', count: stats.learned, icon: '🟢' },
            { label: '需复习', count: stats.review, icon: '🟡' },
            { label: '未学习', count: stats.unlearned, icon: '⚫' },
            { label: '总计', count: stats.total, icon: '📊' }
        ];

        statItems.forEach(item => {
            const statItem = document.createElement('div');
            statItem.className = 'km-stat-item';
            statItem.innerHTML = `
                <span>${item.icon}</span>
                <span>${item.label}: ${item.count}</span>
            `;
            container.appendChild(statItem);
        });
    }

    /**
     * 渲染主内容区域
     */
    renderMainContent() {
        const mainContent = document.createElement('div');
        mainContent.className = 'km-main-content';

        if (this.currentViewMode === 'global') {
            this.renderBattleMapView(mainContent);
        } else {
            const curModule = this.knowledgeData[this.selectedModule];
            const hasChildren = !!(curModule && curModule.children && curModule.children.length);
            if (hasChildren && this.moduleDetailView === 'matrix') {
                this.renderModuleMatrixView(mainContent);
            } else {
                this.renderModuleDetailView(mainContent);
            }
        }

        this.container.appendChild(mainContent);
    }

    // 模块详情 - 矩阵关系图
    renderModuleMatrixView(container) {
        const module = this.knowledgeData[this.selectedModule];
        if (!module) {
            container.innerHTML = '<p>模块不存在</p>';
            return;
        }
        const rows = module.children || [];
        const cols = [
            { key: 'learned', label: '已掌握' },
            { key: 'review', label: '需复习' },
            { key: 'unlearned', label: '未学习' }
        ];
        const table = document.createElement('div');
        table.className = 'km-matrix';
        const header = document.createElement('div');
        header.className = 'km-matrix-row km-matrix-header';
        header.appendChild(this.createMatrixCell('子模块', 'header cell-fixed'));
        cols.forEach(c => header.appendChild(this.createMatrixCell(c.label, 'header')));
        table.appendChild(header);
        rows.forEach(sub => {
            const row = document.createElement('div');
            row.className = 'km-matrix-row';
            row.appendChild(this.createMatrixCell(sub.name, 'row-label cell-fixed'));
            cols.forEach(c => {
                const pts = (sub.knowledgePoints||[]).filter(p => p.status === c.key);
                const density = pts.length;
                const cell = document.createElement('div');
                cell.className = `km-matrix-cell heat-${c.key}`;
                cell.title = `${sub.name} · ${c.label}: ${density}`;
                cell.innerHTML = `<span class="km-matrix-count">${density}</span>`;
                cell.addEventListener('click', () => this.showMatrixDetail(sub.name, c.label, pts));
                row.appendChild(cell);
            });
            table.appendChild(row);
        });
        container.appendChild(table);
    }

    createMatrixCell(text, extra='') {
        const div = document.createElement('div');
        div.className = `km-matrix-cell ${extra}`.trim();
        div.textContent = text;
        return div;
    }

    showMatrixDetail(submoduleName, colLabel, points) {
        const modal = document.createElement('div');
        modal.className = 'km-matrix-modal';
        modal.innerHTML = `
            <div class="km-matrix-modal-content">
                <div class="km-matrix-modal-header">
                    <span>${submoduleName} · ${colLabel}</span>
                    <button class="km-matrix-close">×</button>
                </div>
                <div class="km-matrix-modal-body"></div>
            </div>
        `;
        modal.querySelector('.km-matrix-close').addEventListener('click', () => modal.remove());
        const body = modal.querySelector('.km-matrix-modal-body');
        if (!points.length) {
            body.innerHTML = '<div class="km-empty">暂无数据</div>';
        } else {
            points.forEach(p => {
                const item = document.createElement('div');
                item.className = `km-knowledge-point-detail ${p.status}`;
                item.innerHTML = `<div class="km-point-name">${p.name}</div><div class="km-point-status">${this.getStatusText(p.status)}</div>`;
                body.appendChild(item);
            });
        }
        document.body.appendChild(modal);
    }

    /**
     * 渲染战略地图视图（类似原Obsidian插件的全局视图）
     */
    renderBattleMapView(container) {
        // 创建战略地图容器
        const battleMapContainer = document.createElement('div');
        battleMapContainer.className = 'km-battle-map';
        
        // 按知识点数量排序模块（大的在前）
        const sortedModules = Object.values(this.knowledgeData).sort((a, b) => {
            const aCount = this.getModuleKnowledgePointCount(a);
            const bCount = this.getModuleKnowledgePointCount(b);
            return bCount - aCount;
        });

        // 渲染每个模块的"领土"（使用 DocumentFragment 减少多次回流）
        const frag = document.createDocumentFragment();
        sortedModules.forEach(module => {
            this.renderModuleTerritory(frag, module);
        });
        battleMapContainer.appendChild(frag);

        container.appendChild(battleMapContainer);
    }

    /**
     * 渲染模块领土（战略地图风格）
     */
    renderModuleTerritory(container, module) {
        // 创建模块领土容器
        const territory = document.createElement('div');
        territory.className = 'km-territory km-territory-clickable';
        territory.style.cursor = 'pointer';
        
        // 添加点击事件
        territory.addEventListener('click', () => {
            this.switchToModuleView(module.name);
        });
        
        // 领土标题
        const header = document.createElement('div');
        header.className = 'km-territory-header';
        const title = document.createElement('div');
        title.className = 'km-territory-title';
        
        // 智能处理长标题
        let displayName = module.name;
        if (module.name.length > 8) {
            // 对于长标题，尝试智能缩写
            const nameMap = {
                '言语理解与表达': '言语理解',
                '判断推理': '判断推理',
                '数量关系': '数量关系',
                '资料分析': '资料分析'
            };
            displayName = nameMap[module.name] || module.name;
        }
        
        title.textContent = displayName;
        title.title = module.name; // 完整标题作为tooltip
        header.appendChild(title);
        territory.appendChild(header);

        // 收集所有知识点
        const allPoints = this.collectAllKnowledgePoints(module);
        const totalPoints = allPoints.length;
        
        // 计算网格布局
        const { gridCols, gridRows } = this.calculateGridLayout(totalPoints);
        
        // 创建知识点网格（使用事件委托以减少监听器开销）
        const pointsGrid = document.createElement('div');
        pointsGrid.className = 'km-territory-grid';
        pointsGrid.style.gridTemplateColumns = `repeat(${gridCols}, 1fr)`;
        pointsGrid.style.gridTemplateRows = `repeat(${gridRows}, 1fr)`;
        
        // 渲染每个知识点为网格块（字符串拼接提升创建速度）
        let cellsHtml = '';
        for (let i = 0; i < totalPoints; i++) {
            const p = allPoints[i];
            if (!p) continue;
            const parentAttr = p.parentSubModule ? ` data-parent-sub-module="${this.escapeAttr(p.parentSubModule)}"` : '';
            cellsHtml += `<div class="km-grid-cell status-${this.escapeAttr(p.status)}" data-name="${this.escapeAttr(p.name)}" data-status="${this.escapeAttr(p.status)}"${parentAttr}></div>`;
        }
        pointsGrid.innerHTML = cellsHtml;
        
        // 事件委托：指针悬停/离开/点击统一处理 tooltip
        pointsGrid.addEventListener('pointerover', (e) => {
            const cell = e.target.closest('.km-grid-cell');
            if (!cell || !pointsGrid.contains(cell)) return;
            this.showDelegatedTooltip(cell);
        }, { passive: true });

        pointsGrid.addEventListener('pointerout', (e) => {
            const toEl = e.relatedTarget;
            const leaveGrid = !toEl || !pointsGrid.contains(toEl);
            if (leaveGrid) this.hideTooltip(); else if (toEl && !toEl.closest('.km-grid-cell')) this.hideTooltip();
        }, { passive: true });

        pointsGrid.addEventListener('click', () => this.hideTooltip(), { passive: true });

        // 移动端专用布局：标题进入文流并与网格分隔，避免重叠
        const isMobile = window.matchMedia('(max-width: 768px)').matches;
        if (isMobile) {
            territory.classList.add('km-mobile');
            header.style.position = 'relative';
            header.style.top = '0';
            header.style.left = '0';
            header.style.margin = '8px 12px 0 12px';
            header.style.maxWidth = '100%';
            pointsGrid.style.paddingTop = '12px';
        } else {
            territory.classList.remove('km-mobile');
            // 清理内联样式，防止从移动端切回桌面端后残留
            header.removeAttribute('style');
            pointsGrid.style.paddingTop = '';
        }

        territory.appendChild(pointsGrid);
        container.appendChild(territory);
    }

    /**
     * 渲染模块详细视图
     */
    renderModuleDetailView(container) {
        const module = this.knowledgeData[this.selectedModule];
        if (!module) {
            container.innerHTML = '<p>模块不存在</p>';
            return;
        }

        // 如果有子模块，分别渲染
        if (module.children && module.children.length > 0) {
            module.children.forEach(subModule => {
                this.renderSubModuleDetail(container, subModule);
            });
        }

        // 渲染模块级别的知识点
        if (module.knowledgePoints && module.knowledgePoints.length > 0) {
            this.renderKnowledgePointsDetail(container, module.knowledgePoints, `${module.name}知识点`);
        }
    }

    /**
     * 渲染子模块详细信息
     */
    renderSubModuleDetail(container, subModule) {
        const subModuleDiv = document.createElement('div');
        subModuleDiv.className = 'km-submodule-detail';

        // 子模块标题
        const header = document.createElement('div');
        header.className = 'km-submodule-header';
        
        const title = document.createElement('h4');
        title.textContent = subModule.name;
        
        const progress = document.createElement('div');
        progress.className = 'km-submodule-progress';
        const subModuleStats = this.calculateKnowledgePointsStats(subModule.knowledgePoints);
        progress.textContent = `${subModuleStats.learned}/${subModuleStats.total}`;
        
        header.appendChild(title);
        header.appendChild(progress);
        subModuleDiv.appendChild(header);

        // 渲染子模块的知识点
        this.renderKnowledgePointsDetail(subModuleDiv, subModule.knowledgePoints);

        container.appendChild(subModuleDiv);
    }

    /**
     * 渲染知识点详细列表
     */
    renderKnowledgePointsDetail(container, knowledgePoints, title = null) {
        if (title) {
            const titleEl = document.createElement('h4');
            titleEl.textContent = title;
            titleEl.className = 'km-knowledge-section-title';
            container.appendChild(titleEl);
        }

        const gridContainer = document.createElement('div');
        gridContainer.className = 'km-knowledge-detail-grid';

        knowledgePoints.forEach(point => {
            const pointDiv = document.createElement('div');
            pointDiv.className = `km-knowledge-point-detail ${point.status}`;
            pointDiv.innerHTML = `
                <div class="km-point-name">${point.name}</div>
                <div class="km-point-status">${this.getStatusText(point.status)}</div>
            `;
            gridContainer.appendChild(pointDiv);
        });

        container.appendChild(gridContainer);
    }

    /**
     * 切换到模块视图
     */
    switchToModuleView(moduleName) {
        this.currentViewMode = 'module';
        this.selectedModule = moduleName;
        this.render();
    }

    /**
     * 切换到全局视图
     */
    switchToGlobalView() {
        this.currentViewMode = 'global';
        this.selectedModule = null;
        this.render();
    }

    /**
     * 收集模块的所有知识点
     */
    collectAllKnowledgePoints(module) {
        const allPoints = [];
        
        // 先添加模块级知识点
        if (module.knowledgePoints) {
            allPoints.push(...module.knowledgePoints);
        }
        
        // 再添加子模块知识点
        if (module.children) {
            module.children.forEach(subModule => {
                if (subModule.knowledgePoints) {
                    allPoints.push(...subModule.knowledgePoints);
                }
            });
        }
        
        return allPoints;
    }

    /**
     * 计算网格布局 - 智能布局算法
     */
    calculateGridLayout(totalPoints) {
        if (totalPoints === 0) return { gridCols: 1, gridRows: 1 };
        
        // 根据知识点数量智能选择最佳布局
        if (totalPoints <= 6) {
            // 小数量：优先横向排列
            return { gridCols: Math.min(totalPoints, 3), gridRows: Math.ceil(totalPoints / 3) };
        }
        
        if (totalPoints <= 12) {
            // 中等数量：4列布局
            return { gridCols: 4, gridRows: Math.ceil(totalPoints / 4) };
        }
        
        if (totalPoints <= 25) {
            // 较大数量：5列布局
            return { gridCols: 5, gridRows: Math.ceil(totalPoints / 5) };
        }
        
        if (totalPoints <= 50) {
            // 大数量：6-8列，根据总数优化
            const cols = Math.min(8, Math.ceil(Math.sqrt(totalPoints) * 1.1));
            return { gridCols: cols, gridRows: Math.ceil(totalPoints / cols) };
        }
        
        // 超大数量：使用固定的最大列数
        const maxCols = 10;
        return { gridCols: maxCols, gridRows: Math.ceil(totalPoints / maxCols) };
    }

    /**
     * 获取模块知识点总数
     */
    getModuleKnowledgePointCount(module) {
        return this.collectAllKnowledgePoints(module).length;
    }

    /**
     * 渲染单个模块
     */
    renderModule(container, module) {
        const moduleContainer = document.createElement('div');
        moduleContainer.className = 'km-module-container';

        // 模块标题和进度
        const header = document.createElement('div');
        header.className = 'km-module-header';
        
        const title = document.createElement('h4');
        title.className = 'km-module-title';
        title.textContent = module.name;
        
        const progress = document.createElement('div');
        progress.className = 'km-module-progress';
        const moduleStats = this.calculateModuleStats(module);
        progress.textContent = `${moduleStats.learned}/${moduleStats.total}`;
        
        header.appendChild(title);
        header.appendChild(progress);
        moduleContainer.appendChild(header);

        // 如果有子模块，分别渲染
        if (module.children && module.children.length > 0) {
            module.children.forEach(subModule => {
                this.renderSubModule(moduleContainer, subModule);
            });
        }

        // 渲染模块级别的知识点
        if (module.knowledgePoints && module.knowledgePoints.length > 0) {
            this.renderKnowledgeGrid(moduleContainer, module.knowledgePoints, `${module.name}知识点`);
        }

        container.appendChild(moduleContainer);
    }

    /**
     * 渲染子模块
     */
    renderSubModule(container, subModule) {
        const subModuleDiv = document.createElement('div');
        subModuleDiv.className = 'km-submodule';

        // 子模块标题
        const header = document.createElement('div');
        header.className = 'km-submodule-header';
        header.textContent = subModule.name;
        
        const progress = document.createElement('div');
        progress.className = 'km-submodule-progress';
        const subModuleStats = this.calculateKnowledgePointsStats(subModule.knowledgePoints);
        progress.textContent = `${subModuleStats.learned}/${subModuleStats.total}`;
        
        header.appendChild(document.createTextNode(subModule.name));
        header.appendChild(progress);
        subModuleDiv.appendChild(header);

        // 渲染子模块的知识点
        this.renderKnowledgeGrid(subModuleDiv, subModule.knowledgePoints, null, true);

        container.appendChild(subModuleDiv);
    }

    /**
     * 渲染知识点网格
     */
    renderKnowledgeGrid(container, knowledgePoints, title = null, isSubModule = false) {
        const gridContainer = document.createElement('div');
        gridContainer.className = isSubModule ? 'km-submodule-grid' : 'km-knowledge-grid';

        knowledgePoints.forEach(point => {
            const pointDiv = document.createElement('div');
            pointDiv.className = `km-knowledge-point ${point.status}`;
            pointDiv.textContent = point.name;
            pointDiv.title = `${point.name} (${this.getStatusText(point.status)})`;
            
            // 添加悬浮效果（只读，不可点击）
            pointDiv.addEventListener('mouseenter', () => {
                pointDiv.style.transform = 'translateY(-2px)';
            });
            pointDiv.addEventListener('mouseleave', () => {
                pointDiv.style.transform = 'translateY(0)';
            });

            gridContainer.appendChild(pointDiv);
        });

        container.appendChild(gridContainer);
    }

    /**
     * 计算全局统计信息
     */
    calculateGlobalStats() {
        let stats = { learned: 0, review: 0, unlearned: 0, total: 0 };

        Object.values(this.knowledgeData).forEach(module => {
            const moduleStats = this.calculateModuleStats(module);
            stats.learned += moduleStats.learned;
            stats.review += moduleStats.review;
            stats.unlearned += moduleStats.unlearned;
            stats.total += moduleStats.total;
        });

        return stats;
    }

    /**
     * 计算模块统计信息
     */
    calculateModuleStats(module) {
        let allPoints = [...(module.knowledgePoints || [])];
        
        if (module.children) {
            module.children.forEach(subModule => {
                allPoints.push(...(subModule.knowledgePoints || []));
            });
        }

        return this.calculateKnowledgePointsStats(allPoints);
    }

    /**
     * 计算知识点统计信息
     */
    calculateKnowledgePointsStats(knowledgePoints) {
        const stats = { learned: 0, review: 0, unlearned: 0, total: knowledgePoints.length };

        knowledgePoints.forEach(point => {
            switch (point.status) {
                case 'learned':
                    stats.learned++;
                    break;
                case 'review':
                    stats.review++;
                    break;
                case 'unlearned':
                    stats.unlearned++;
                    break;
            }
        });

        return stats;
    }

    /**
     * 获取状态文本
     */
    getStatusText(status) {
        const statusMap = {
            'learned': '已掌握',
            'review': '需复习',
            'unlearned': '未学习'
        };
        return statusMap[status] || '未知';
    }

    /**
     * 添加高级tooltip
     */
    addTooltip(element, point) {
        let tooltip = null;
        
        const show = (e) => {
            tooltip = document.createElement('div');
            tooltip.className = 'km-tooltip';
            tooltip.innerHTML = `
                <div class="km-tooltip-title">${point.name}</div>
                <div class="km-tooltip-status">
                    <span class="km-tooltip-status-indicator status-${point.status}"></span>
                    ${this.getStatusText(point.status)}
                </div>
                ${point.parentSubModule ? `<div class="km-tooltip-module">模块: ${point.parentSubModule}</div>` : ''}
            `;
            
            document.body.appendChild(tooltip);
            
            // 定位tooltip
            const rect = element.getBoundingClientRect();
            const tooltipRect = tooltip.getBoundingClientRect();
            
            let left = rect.left + rect.width / 2 - tooltipRect.width / 2;
            let top = rect.top - tooltipRect.height - 8;
            
            // 边界检查
            if (left < 8) left = 8;
            if (left + tooltipRect.width > window.innerWidth - 8) {
                left = window.innerWidth - tooltipRect.width - 8;
            }
            if (top < 8) {
                top = rect.bottom + 8;
                tooltip.classList.add('km-tooltip-bottom');
            }
            
            tooltip.style.left = left + 'px';
            tooltip.style.top = top + 'px';
            
            // 动画显示
            requestAnimationFrame(() => {
                tooltip.classList.add('km-tooltip-show');
            });

            // 自动隐藏（2.5s）
            tooltip._timer = setTimeout(() => hide(), 2500);
            // 点击隐藏
            tooltip.addEventListener('click', hide);
        };

        const hide = () => {
            if (!tooltip) return;
            tooltip.classList.remove('km-tooltip-show');
            if (tooltip._timer) clearTimeout(tooltip._timer);
            setTimeout(() => {
                if (tooltip && tooltip.parentNode) tooltip.parentNode.removeChild(tooltip);
                tooltip = null;
            }, 180);
        };

        element.addEventListener('mouseenter', show);
        element.addEventListener('mouseleave', hide);
        element.addEventListener('click', hide);
    }

    // 单例 tooltip：用于事件委托渲染，减少DOM创建与监听器数量
    ensureTooltipEl() {
        if (this._tooltipEl) return this._tooltipEl;
        const el = document.createElement('div');
        el.className = 'km-tooltip';
        document.body.appendChild(el);
        this._tooltipEl = el;
        return el;
    }

    showDelegatedTooltip(cell) {
        const name = cell.dataset.name || '';
        const status = cell.dataset.status || 'unlearned';
        const parent = cell.dataset.parentSubModule;

        const tooltip = this.ensureTooltipEl();
        tooltip.innerHTML = `
            <div class="km-tooltip-title">${name}</div>
            <div class="km-tooltip-status">
                <span class="km-tooltip-status-indicator status-${status}"></span>
                ${this.getStatusText(status)}
            </div>
            ${parent ? `<div class=\"km-tooltip-module\">子模块: ${parent}</div>` : ''}
        `;

        // 定位
        const rect = cell.getBoundingClientRect();
        const tipRect = tooltip.getBoundingClientRect();
        let left = rect.left + rect.width / 2 - tipRect.width / 2;
        let top = rect.top - tipRect.height - 8;
        if (left < 8) left = 8;
        if (left + tipRect.width > window.innerWidth - 8) left = window.innerWidth - tipRect.width - 8;
        if (top < 8) { top = rect.bottom + 8; tooltip.classList.add('km-tooltip-bottom'); } else { tooltip.classList.remove('km-tooltip-bottom'); }
        tooltip.style.left = left + 'px';
        tooltip.style.top = top + 'px';

        // 显示
        tooltip.classList.add('km-tooltip-show');

        // 自动隐藏
        clearTimeout(this._tooltipTimer);
        this._tooltipTimer = setTimeout(() => this.hideTooltip(), 2500);
    }

    hideTooltip() {
        clearTimeout(this._tooltipTimer);
        if (!this._tooltipEl) return;
        this._tooltipEl.classList.remove('km-tooltip-show');
        // 轻微延迟以匹配过渡
        setTimeout(() => {
            if (this._tooltipEl) {
                this._tooltipEl.style.left = '-9999px';
                this._tooltipEl.style.top = '-9999px';
            }
        }, 180);
    }

    /**
     * 添加页面进度指示器
     */
    addProgressIndicator() {
        const stats = this.calculateGlobalStats();
        const progressPercentage = Math.round((stats.learned / stats.total) * 100);
        
        // 更新页面标题
        document.title = `知识地图 (${progressPercentage}%) - 公考小饭团`;
        
        // 可以在这里添加更多的进度指示器
    }

    /**
     * 安全转义到HTML属性
     */
    escapeAttr(value) {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    /**
     * 显示错误信息
     */
    showError(message) {
        this.container.innerHTML = `
            <div class="knowledge-loading" style="color: var(--km-danger);">
                ❌ ${message}
            </div>
        `;
    }
}

// 确保在全局范围内可用
window.KnowledgeMapRenderer = KnowledgeMapRenderer;
/* 强制刷新缓存 - 09/14/2025 11:57:18 */
