const { expect } = require("chai");
const hre = require("hardhat");

describe("ScrollBuffer", function () {
    let scrollBuffer;
    let owner;
    let user1;
    let user2;
    const initialTarget = hre.ethers.parseEther("100");

    beforeEach(async function () {
        [owner, user1, user2] = await hre.ethers.getSigners();
        const ScrollBuffer = await hre.ethers.getContractFactory("ScrollBuffer");
        scrollBuffer = await ScrollBuffer.deploy(initialTarget);
        await scrollBuffer.waitForDeployment();
    });

    describe("Deposits", function () {
        it("should accept deposits", async function () {
            const depositAmount = hre.ethers.parseEther("1");
            await scrollBuffer.connect(user1).deposit({ value: depositAmount });
            
            const balance = await scrollBuffer.connect(user1).getBalance();
            expect(balance).to.equal(depositAmount);
        });
    });

    describe("Withdrawals", function () {
        beforeEach(async function () {
            await scrollBuffer.connect(user1).deposit({ 
                value: hre.ethers.parseEther("10")
            });
        });

        it("should allow full withdrawal when buffer is healthy", async function () {
            const withdrawAmount = hre.ethers.parseEther("1");
            const initialBalance = await hre.ethers.provider.getBalance(user1.address);
            
            const tx = await scrollBuffer.connect(user1).curveWithdrawal(withdrawAmount);
            const receipt = await tx.wait();
            const gasUsed = receipt.gasUsed * receipt.effectiveGasPrice;
            
            const finalBalance = await hre.ethers.provider.getBalance(user1.address);
            const actualChange = finalBalance - initialBalance + gasUsed;
            
            expect(withdrawAmount).to.equal(actualChange);
        });

        it("should apply slippage when buffer health is low", async function () {
            const largeWithdraw = hre.ethers.parseEther("9");
            await scrollBuffer.connect(user1).curveWithdrawal(largeWithdraw);
            
            const withdrawAmount = hre.ethers.parseEther("0.5");
            const tx = await scrollBuffer.connect(user1).curveWithdrawal(withdrawAmount);
            const receipt = await tx.wait();
            
            const event = receipt.logs[0];
            const iface = new hre.ethers.Interface([
                "event Withdrawal(address indexed user, uint256 requested, uint256 received)"
            ]);
            const decodedEvent = iface.parseLog(event);
            
            expect(decodedEvent.args.received).to.be.lessThan(decodedEvent.args.requested);
        });
    });

    describe("Target Updates", function () {
        it("should update target based on health history", async function () {
            await scrollBuffer.recordHealth();
            await scrollBuffer.recordHealth();
            
            const target = await scrollBuffer.target();
            await scrollBuffer.updateTarget();
            const newTarget = await scrollBuffer.target();
            
            // The test may need adjustment based on actual health values
            expect(newTarget).to.not.equal(target);
        });
    });
});