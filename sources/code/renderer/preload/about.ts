import { ipcRenderer as ipc } from "electron/renderer";
import { buildInfo, getAppIcon } from "../../common/global";
import { getAppPath } from "../../common/modules/electron";
import { resolve } from "path";
import L10N from "../../common/modules/l10n";
import packageJson, { PackageJSON, Person } from "../../common/modules/package";
import { createHash } from "crypto";

/**
 * Fetches user avatar by making the requests to both GitHub and Gravatar
 * services and picking the promise that resolves first. It is also designed to
 * cancel all presenting fetches when once has been already resolved to conserve
 * the network and cleanup the code.
 */
async function getUserAvatar(person: Person, size = 96) {
    const sources = [], promises = [], controler = new AbortController();
    sources.push("https://github.com/"+encodeURIComponent(person.name)+".png?size="+size.toString());
    if(person.email)
        sources.push("https://gravatar.com/avatar/"+createHash("md5").update(person.email).digest('hex')+'?d=404&s='+size.toString())
    for(const source of sources) {
        promises.push(fetch(source, { signal: controler.signal }).then(async (data) => {
            if(data.ok && data.headers.get("Content-Type")?.startsWith("image")) {
                const blobUrl =  URL.createObjectURL(await data.blob());
                const image = document.createElement('img');
                image.src = blobUrl;
                image.addEventListener('load', () => URL.revokeObjectURL(blobUrl));
                return image;
            } else if(data.ok)
                throw new Error('[Avatar] Not an image!')
            else
                throw new Error('[Avatar] HTTP '+data.status.toString()+data.statusText);
        }));
    }
    return await Promise.any(promises).finally(() => controler.abort());
}

function addContributor(person: Person, role?: string) {
    const container = document.createElement('div');
    const description = document.createElement('div');
    
    void getUserAvatar(person)
        .then(avatar => container.prepend(avatar));
    
    container.classList.add("contributor");

    const nameElement = document.createElement('h2');  
    const link = document.createElement('a');
    if(typeof person.url === 'string')
        link.href = person.url;
    else if (typeof person.email === 'string')
        link.href = 'mailto:'+person.email
    if(link.href !== '') {
        link.innerText = person.name;
        link.rel="noreferrer";
        link.target="_blank";
        nameElement.appendChild(link);
    } else {
        link.remove();
        nameElement.innerText = person.name;
    }
    description.appendChild(nameElement);

    if(role) {
        const roleElement = document.createElement('p');
        roleElement.classList.add("description")
        roleElement.innerText = role;
        description.appendChild(roleElement);
    }
    container.appendChild(description);
    document.getElementById("credits")?.appendChild(container);
}

const locks = { 
    dialog: false
}

interface aboutWindowDetails {
    appName: string;
    appVersion: string;
    appRepo: string|undefined;
    buildInfo: buildInfo;
    responseId: number;
}

function event2promise<C extends EventTarget>(emitter:C, channel:Parameters<C["addEventListener"]>[0]) {
    return new Promise<void>(
        (resolve) => emitter.addEventListener(
            channel, () => resolve(), { once: true }
        )
    );
}

function showAppLicense() {
    if(!locks.dialog) {
        locks.dialog = true;
        void import('fs/promises')
            .then(fs => fs.readFile)
            .then(read => read(resolve(getAppPath(), 'LICENSE')))
            .then(data => data.toString())
            .then(license => {
                const dialog = document.createElement('div');
                const content = document.createElement('div');
                dialog.classList.add('dialog');
                console.log(license.replace(/\n(!=[^\n])/g,' '));
                content.innerText = license.replace(/(?<!\n)\n(?!\n)/g,' ');
                dialog.appendChild(content);
                document.getElementById("licenses")?.appendChild(dialog);
                const animations = [...dialog.getAnimations(), ...content.getAnimations()];
                for (const animation of animations)
                    animation.persist();
                dialog.addEventListener('click', () => {
                    const promises = [];
                    for (const animation of animations) {
                        animation.reverse();
                        promises.push(event2promise(animation, "finish"));
                    }
                    Promise.allSettled(promises).finally(() => {
                        dialog.remove();
                        content.remove();
                        locks.dialog = false;
                    });
                }, { once: true });
            });
    }
}

function generateAppContent(l10n:L10N["web"]["aboutWindow"], details:aboutWindowDetails) {
    const nameElement = document.getElementById("appName");
    const versionElement = document.getElementById("appVersion");
    const repoElement = document.getElementById("appRepo");
    if(!nameElement || !versionElement || !repoElement) return;
    nameElement.innerText = details.appName + " ("+details.buildInfo.type+")";
    versionElement.innerText = 'v' + details.appVersion + (details.buildInfo.commit !== undefined ? "-"+details.buildInfo.commit.substring(0, 7) : "");
    (document.getElementById("logo") as HTMLImageElement).src = getAppIcon([256,192,128,96])
    
    if(repoElement.tagName === 'A')
        (repoElement as HTMLAnchorElement).href = details.appRepo??'';
    
    for (const id of Object.keys(l10n.about)) {
        const element = document.getElementById(id);
        if(element) 
            element.innerText = l10n.about[id as keyof typeof l10n.about]
    }
    for (const id of ['electron', 'chrome', 'node']) {
        const element = document.getElementById(id);
        if(element)
            element.innerText = process.versions[id as keyof typeof process.versions]??"unknown"
    }
}

function generateLicenseContent(l10n:L10N["web"]["aboutWindow"], name:string) {
    const packageJson = new PackageJSON(["dependencies", "devDependencies"]);
    for (const id of Object.keys(l10n.licenses).filter((value)=>value.match(/^(?:licensedUnder|packageAuthors)$/) === null)) {
        const element = document.getElementById(id)
        if(element) 
            element.innerText = l10n.licenses[id as keyof typeof l10n.licenses]
                .replace("%s",name);
    }
    for (const packName in packageJson.data.dependencies) {
        if(packName.startsWith('@spacingbat3/')) continue;
        const {data} = new PackageJSON(
            ["author", "license"],
            resolve(getAppPath(), "node_modules/"+packName+"/package.json")
        )
        const npmLink = document.createElement("a");
        const title = document.createElement("h3");
        const copy = document.createElement("p");
        npmLink.href = "https://www.npmjs.com/package/"+packName;
        npmLink.relList.add("noreferrer");
        npmLink.target = "_blank";
        title.innerText = packName;
        copy.innerText = "© " +
            new Person(data.author ?? '"'+l10n.licenses.packageAuthors.replace("%s", packName)+'"').name + " " + l10n.licenses.licensedUnder.replace("%s",data.license)
        npmLink.appendChild(title);
        document.getElementById("licenses")?.appendChild(npmLink);
        document.getElementById("licenses")?.appendChild(copy);
    }
}

// Continue only on the local sites.
if(window.location.protocol !== "file:") {
    console.error("If you're seeing this, you probably have just messed something within the application. Congratulations!");
    throw new URIError("Loaded website is not a local page!");
}

// Get app details and inject them into the page
window.addEventListener("load", () => {
    ipc.send("about.getDetails");
    const close = document.getElementById("closebutton");
    if (close)
        close.addEventListener("click", () => {
            ipc.send("about.close");
        }, {once:true});
    else
        throw new Error("Couldn't find element with 'closebutton' id.");
});

ipc.on("about.getDetails", (_event, details:aboutWindowDetails) => {
    const l10n = new L10N().web.aboutWindow;
    // Header sections names
    for(const div of document.querySelectorAll<HTMLDivElement>("nav > div")) {
        const content = div.querySelector<HTMLDivElement>("div.content");
        if(content) content.innerText = l10n.nav[div.id.replace("-nav","") as keyof typeof l10n.nav]
    }
    generateAppContent(l10n, details);
    {
        if(packageJson.data.author)
            addContributor(new Person(packageJson.data.author), l10n.credits.people.author)
        for (const person of packageJson.data.contributors??[]) {
            const safePerson = new Person(person);
            let translation:string = l10n.credits.people.contributors.default;
            if(safePerson.name in l10n.credits.people.contributors)
                translation = l10n.credits.people.contributors[safePerson.name as keyof typeof l10n.credits.people.contributors];
            addContributor(safePerson, translation);
        }
    }
    generateLicenseContent(l10n, details.appName);
    // Initialize license button
    document.getElementById("showLicense")?.addEventListener("click", () => {
        for(const animation of document.getElementById("showLicense")?.getAnimations()??[]) {
            setTimeout(showAppLicense,100);
            animation.currentTime = 0;
            animation.play();
            animation.addEventListener("finish",()=>{
                animation.pause();
                animation.currentTime = 0;
            }, {once: true});
        }
    })
    document.body.style.display = "initial";
    ipc.send("about.readyToShow");
});