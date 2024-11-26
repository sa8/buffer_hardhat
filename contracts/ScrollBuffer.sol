// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract ScrollBuffer is Ownable(msg.sender), ReentrancyGuard {
    uint256 public constant ALPHA = 2;
    uint256 public constant BOND = 4 ether;
    uint256 public constant HEALTHY_BUFFER = 80; // 0.8 in percentage
    uint256 public constant SCALE = 100;
    uint256 public constant BASE_TARGET_PERCENTAGE = 20; // 20% of total as base target
    
    uint256 public target;
    uint256 public totalBalance;
    uint256 public stakedAmount;
    mapping(address => uint256) public balances;
    
    uint256[] public healthHistory;
    uint256 public lastUpdateTime;

    event Deposit(address indexed user, uint256 amount);
    event Withdrawal(address indexed user, uint256 requested, uint256 received);
    event TargetUpdated(uint256 newTarget);
    event StakeExecuted(uint256 amount);
    event UnstakeExecuted(uint256 amount);

    constructor(uint256 initialStakedAmount) {
        stakedAmount = initialStakedAmount;
        target = (getTotalAmount() * BASE_TARGET_PERCENTAGE) / SCALE;
        lastUpdateTime = block.timestamp;
    }

    receive() external payable {
        deposit();
    }

    function getTotalAmount() public view returns (uint256) {
        return stakedAmount + address(this).balance;
    }

    function deposit() public payable nonReentrant {
        require(msg.value > 0, "Must deposit ETH");
        balances[msg.sender] += msg.value;
        totalBalance += msg.value;
        emit Deposit(msg.sender, msg.value);
    }

    function curveWithdrawal(uint256 amount) external nonReentrant {
        require(balances[msg.sender] >= amount, "Insufficient balance");
        require(amount <= address(this).balance, "Insufficient contract balance");

        uint256 multiplier = bufferHealth(address(this).balance - amount);
        uint256 withdrawAmount;

        if (multiplier > HEALTHY_BUFFER) {
            withdrawAmount = amount;
        } else {
            withdrawAmount = amount * (20 + multiplier) / SCALE;
        }

        balances[msg.sender] -= amount;
        totalBalance -= amount;
        
        (bool success,) = payable(msg.sender).call{value: withdrawAmount}("");
        require(success, "Transfer failed");
        
        emit Withdrawal(msg.sender, amount, withdrawAmount);
    }

    function bufferHealth(uint256 b) public view returns (uint256) {
        if (target == 0) return 0;
        return (b * SCALE) / target;
    }

    function updateTarget() external onlyOwner {
        uint256 currentHealth = bufferHealth(address(this).balance);
        uint256 baseTarget = (getTotalAmount() * BASE_TARGET_PERCENTAGE) / SCALE;
        uint256 newTarget;
        
        if (currentHealth < SCALE) {
            // Increase target more aggressively when health is low
            uint256 increase = (baseTarget * (SCALE - currentHealth) * 150) / (SCALE * SCALE);
            newTarget = baseTarget + increase;
        } else if (currentHealth > SCALE) {
            // Decrease target gradually when health is high
            uint256 decrease = (baseTarget * (currentHealth - SCALE) * 50) / (SCALE * SCALE);
            if (decrease < baseTarget) {
                newTarget = baseTarget - decrease;
            } else {
                newTarget = baseTarget / 2; // Floor at 50% of base target
            }
        } else {
            newTarget = baseTarget;
        }
        
        // Ensure target doesn't exceed total amount
        target = min(newTarget, getTotalAmount());
        emit TargetUpdated(target);
        
        // Clear health history and update timestamp
        healthHistory = new uint256[](0);
        lastUpdateTime = block.timestamp;
        
        // Trigger stake/unstake if needed
        if (address(this).balance > target) {
            _triggerStake();
        } else if (address(this).balance < target) {
            _triggerUnstake();
        }
    }

    function _triggerStake() internal {
        uint256 excessAmount = address(this).balance - target;
        stakedAmount += excessAmount;
        emit StakeExecuted(excessAmount);
    }

    function _triggerUnstake() internal {
        uint256 shortfall = target - address(this).balance;
        if (shortfall <= stakedAmount) {
            stakedAmount -= shortfall;
            emit UnstakeExecuted(shortfall);
        }
    }

    function recordHealth() external {
        healthHistory.push(bufferHealth(address(this).balance));
    }

    function getAverageHealth() public view returns (uint256) {
        if (healthHistory.length == 0) return SCALE;
        
        uint256 sum;
        for (uint256 i = 0; i < healthHistory.length; i++) {
            sum += healthHistory[i];
        }
        return sum / healthHistory.length;
    }

    function getBalance() external view returns (uint256) {
        return balances[msg.sender];
    }

    function min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }
}