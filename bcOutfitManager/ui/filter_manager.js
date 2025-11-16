export class FilterManager {
    constructor(containerElement, itemMap) {
        if (!containerElement || containerElement.nodeType !== 1) {
            throw new Error("containerElement must be a DOM element");
        }

        this.container = containerElement;
        this.shadow = this.container.attachShadow({ mode: "open" });

        // 预处理：Map → entries[]
        this.items = [];
        for (const [key, data] of itemMap.entries()) {
            this.items.push({ key, data, active: true });
        }

        // 分组
        this.groups = [{ groupID: "Hair", itemList: [] }, { groupID: "Appearance", itemList: [] }, { groupID: "Cosplay", itemList: [] }, { groupID: "Body", itemList: [] }, { groupID: "Item", itemList: [] }];

        // 遍历 items 生成分组
        this.items.forEach(item => {
            const g = this.groupByFunc(item.data);

            // 查找已有组
            let group = this.groups.find(gr => gr.groupID === g);

            // 如果组不存在，创建新组
            if (!group) {
                group = { groupID: g, itemList: [] };
                this.groups.push(group);
            }

            // 添加 item
            group.itemList.push(item);
        });

        this.buttons = {};

        this.render();
    }

    groupByFunc(data) {
        const HairList = ["HairFront", "HairBack", "新前发_Luzi", "新后发_Luzi", "额外头发_Luzi"]; // List of hair item names to apply
        const BodyGroupNamesList = ["Height", "BodyUpper", "Blush", "Fluids", "Emoticon", "HandsLeft", "HandsRight", "ArmsLeft", "ArmsRight", "Eyes2", "Eyes", "Nipples", "Pronouns", "Head", "Mouth", "Pussy", "BodyLower", "FacialHair", "Eyebrows", "左眼_Luzi", "右眼_Luzi"];
        if (HairList.includes(data.Name)) return "Hair";
        // 身体类 → Body
        if (BodyGroupNamesList.includes(data.Name)) return "Body";
        if (data.BodyCosplay) return "Cosplay";
        if (data.Category === "Item") return "Item";
        else return "Appearance";
    }



    render() {
        // ---- style ----
        const style = document.createElement("style");
        style.textContent = `
        .filter-container {
            height: 100%;
            display:flex;
            flex-direction:column;
            border:1px solid #ccc;
            border-radius:6px;
            overflow:hidden;
            background:#fff;
            font-size:13px;
        }

        .fm-filter-top {
            padding:6px;
            border-bottom:1px solid #ddd;
            display:flex;
            flex-wrap:wrap;
            gap:6px;
        }

        .filter-batch-btn {
            padding:4px 8px;
            background:#fff;
            border:1px solid #bbb;
            border-radius:4px;
            cursor:pointer;
            font-size:12px;
        }
        .filter-batch-btn:active { transform:translateY(1px); }

        .fm-filter-scroll {
            flex:1;
            overflow-y:auto;
            padding:6px;
            display:flex;
            flex-direction:column;
            gap:12px;
        }

        .filter-group {
            border:1px solid #ddd;
            border-radius:6px;
            padding:6px;
            background:#fafafa;
            display:flex;
            flex-direction:column;
            gap:6px;
        }

        .filter-group-title {
            font-weight:bold;
            color:#555;
            padding-bottom:4px;
            border-bottom:1px solid #eee;
        }

        .filter-btn-row {
            display:flex;
            flex-wrap:wrap;
            gap:6px;
        }

        .filter-item-btn {
            padding:4px 8px;
            border-radius:4px;
            border:1px solid #ccc;
            background:#fff;
            cursor:pointer;
            font-size:12px;
        }

        .filter-item-btn.active {
            background:#77dd77;
        }
        `;
        this.shadow.appendChild(style);

        // ---- 主容器 ----
        const container = document.createElement("div");
        container.className = "filter-container";

        // 顶部批量按钮区
        const top = document.createElement("div");
        top.className = "fm-filter-top";
        top.id = "filter-top";

        // 滚动内容区
        const scroll = document.createElement("div");
        scroll.className = "fm-filter-scroll";
        scroll.id = "filter-scroll";

        container.appendChild(top);
        container.appendChild(scroll);
        this.shadow.appendChild(container);

        this.renderBatchButtons(top);
        this.renderGroups(scroll);
        this.refreshButtons();
    }

    // -----------------------------
    // 顶部：批量按钮
    // -----------------------------
    renderBatchButtons(top) {
        const btnAll = this.makeBatchBtn("全开", () => {
            this.items.forEach(i => i.active = true);
            this.refreshButtons();
        });

        const btnNone = this.makeBatchBtn("全关", () => {
            this.items.forEach(i => i.active = false);
            this.refreshButtons();
        });

        const btnInvert = this.makeBatchBtn("反选", () => {
            this.items.forEach(i => i.active = !i.active);
            this.refreshButtons();
        });

        top.appendChild(btnAll);
        top.appendChild(btnNone);
        top.appendChild(btnInvert);
    }

    makeBatchBtn(label, handler) {
        const btn = document.createElement("button");
        btn.className = "filter-batch-btn";
        btn.textContent = label;
        btn.addEventListener("click", handler);
        return btn;
    }

    // -----------------------------
    // 主体：渲染分组
    // -----------------------------
    renderGroups(scroll) {
        this.groups.forEach(group => {
            const g = document.createElement("div");
            g.className = "filter-group";

            // 组标题
            const title = document.createElement("div");
            title.className = "filter-group-title";
            title.textContent = group.groupID;

            g.appendChild(title);





            // 组内批量按钮行
            const batchRow = document.createElement("div");
            batchRow.className = "filter-btn-row";

            const btnAll = this.makeBatchBtn("全开", () => {
                group.itemList.forEach(item => item.active = true);
                this.refreshButtons();
            });
            const btnNone = this.makeBatchBtn("全关", () => {
                group.itemList.forEach(item => item.active = false);
                this.refreshButtons();
            });
            const btnInvert = this.makeBatchBtn("反选", () => {
                group.itemList.forEach(item => item.active = !item.active);
                this.refreshButtons();
            });

            batchRow.appendChild(btnAll);
            batchRow.appendChild(btnNone);
            batchRow.appendChild(btnInvert);


            g.appendChild(batchRow);

            const divider = document.createElement("div");
            divider.style.height = "1px";
            divider.style.background = "#ddd";
            divider.style.margin = "4px 0";
            g.appendChild(divider);

            // 按钮行
            const row = document.createElement("div");
            row.className = "filter-btn-row";


            group.itemList.forEach(item => {
                const btn = document.createElement("button");
                btn.className = "filter-item-btn";
                btn.textContent = item.data.Description || item.data.description;

                btn.addEventListener("click", () => {
                    item.active = !item.active;
                    btn.classList.toggle("active", item.active);
                });

                this.buttons[item.key] = btn;
                row.appendChild(btn);
            });

            g.appendChild(row);
            scroll.appendChild(g);
        });
    }

    refreshButtons() {
        for (const item of this.items) {
            const btn = this.buttons[item.key];
            if (btn)
                btn.classList.toggle("active", item.active);
        }
    }

    // 外部接口：返回选中的值
    getActiveSet(reverse = false, field = "Name") {
        const s = new Set();
        this.items.forEach(item => {
            if (!reverse && item.active) s.add(item.data[field]);
            if (reverse && !item.active) s.add(item.data[field]);
        });
        return s;
    }

    getFullSet(field = "Name") {
        const s = new Set();
        this.items.forEach(item => {
            s.add(item.data[field]);
        });
        return s;
    }
}