const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ScrollBuffer", function () {
    let scrollBuffer;
    let owner;
    let user1;
    let user2;
    const initialTarget = ethers.parseEther("100");

    beforeEach(async function () {
        [owner, user1, user2] = await ethers.getSigners();
        const ScrollBuffer = await ethers.getContractFactory("ScrollBuffer");
        scrollBuffer = await ScrollBuffer.deploy(initialTarget);
        await scrollBuffer.waitForDeployment();
    });

    describe("Deposits", function () {
        it("should accept deposits", async function () {
            const depositAmount = ethers.parseEther("1");
            await scrollBuffer.connect(user1).deposit({ value: depositAmount });
            const balance = await scrollBuffer.connect(user1).getBalance();
            expect(balance).to.equal(depositAmount);
        });
    });

    describe("Withdrawals", function () {
        beforeEach(async function () {
            await scrollBuffer.connect(user1).deposit({ 
                value: ethers.parseEther("10")
            });
        });

        it("should allow full withdrawal when buffer is healthy", async function () {
            const withdrawAmount = ethers.parseEther("1");
            const initialBalance = await ethers.provider.getBalance(user1);
            
            const tx = await scrollBuffer.connect(user1).curveWithdrawal(withdrawAmount);
            const receipt = await tx.wait();
            const gasSpent = receipt.gasUsed * tx.gasPrice;
            
            const finalBalance = await ethers.provider.getBalance(user1);
            const actualChange = finalBalance - initialBalance + gasSpent;
            
            expect(withdrawAmount).to.equal(actualChange);
        });

        it("should apply slippage when buffer health is low", async function () {
            const largeWithdraw = ethers.parseEther("9");
            await scrollBuffer.connect(user1).curveWithdrawal(largeWithdraw);
            
            const withdrawAmount = ethers.parseEther("0.5");
            const tx = await scrollBuffer.connect(user1).curveWithdrawal(withdrawAmount);
            const receipt = await tx.wait();
            
            const event = receipt.logs[0];
            const iface = new ethers.Interface([
                "event Withdrawal(address indexed user, uint256 requested, uint256 received)"
            ]);
            const decodedEvent = iface.parseLog(event);
            
            expect(decodedEvent.args.received).to.be.lessThan(decodedEvent.args.requested);
        });
    });

    describe("Target Updates", function () {
        it("should update target based on health history", async function () {
            const address = await scrollBuffer.getAddress();
            const target = await ethers.provider.getStorage(address, 3);
            
            await scrollBuffer.recordHealth();
            await scrollBuffer.recordHealth();
            await scrollBuffer.connect(owner).updateTarget();
            
            const newTarget = await ethers.provider.getStorage(address, 3);
            expect(newTarget).to.not.equal(target);
        });
    });
});